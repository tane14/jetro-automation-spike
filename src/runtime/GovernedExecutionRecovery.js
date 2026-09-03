"use strict";

/**
 * Governed execution recovery v1.5.
 *
 * Repairs partial Task/Execution persistence from canonical facts only.
 * Does not create authority, invoke a runner, complete Tasks, approve, or merge.
 * Caller flags (force/allowed/passed/recover) are never authority.
 * Evidence emitted here is DATA only.
 *
 * MULTI_FILE_ATOMICITY=NO. FAIL_CLOSED=YES. EVIDENCE_AUTHORITY=NO.
 */

const {
  validateDocument,
  stampContractHash,
  verifyContractBinding,
  validateCorrelation,
  validateTransition,
} = require("../contracts");
const { assertStore } = require("./MissionTaskStore");
const { assertCanonicalId } = require("./ids");
const { RuntimeValidationError } = require("./MissionTaskRuntime");
const { MemoryEvidenceSink } = require("./GovernedExecutionRuntime");
const { buildGovernedRunEvidence, nextEvidenceId } = require("./GovernedRunEvidence");
const { validateRunnerResult } = require("./RunnerResultValidator");

const SCHEMA_VERSION = "1.5-governed-execution-recovery";
const RECORD_KIND = "governed_execution_recovery_result";
const EVIDENCE_KIND = "governed_execution_recovery_evidence_data";
const KNOWN_INVOCATION_STATES = new Set(["INVOKED", "RETURNED"]);

const CLASSIFICATION = {
  CONSISTENT: "CONSISTENT",
  RECOVERABLE_START_PARTIAL: "RECOVERABLE_START_PARTIAL",
  RECOVERABLE_RESULT_PARTIAL: "RECOVERABLE_RESULT_PARTIAL",
  RECOVERABLE_EVIDENCE_MISSING: "RECOVERABLE_EVIDENCE_MISSING",
  STALE_LEASE: "STALE_LEASE",
  AMBIGUOUS_RUNNER_INVOCATION: "AMBIGUOUS_RUNNER_INVOCATION",
  CORRUPT_BINDING: "CORRUPT_BINDING",
  UNRECOVERABLE: "UNRECOVERABLE",
};

const BLOCKED_CLASSIFICATIONS = new Set([
  CLASSIFICATION.STALE_LEASE,
  CLASSIFICATION.AMBIGUOUS_RUNNER_INVOCATION,
  CLASSIFICATION.CORRUPT_BINDING,
  CLASSIFICATION.UNRECOVERABLE,
]);

function fail(errors) {
  throw new RuntimeValidationError(errors);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function recoveryIdFor(executionId) {
  return `RECV-${executionId}`;
}

function leaseExpired(execution, now) {
  if (!execution || typeof execution.leased_at !== "string") {
    return true;
  }
  if (typeof execution.lease_ttl_seconds !== "number") {
    return true;
  }
  const leasedAt = Date.parse(execution.leased_at);
  if (Number.isNaN(leasedAt)) {
    return true;
  }
  return now.getTime() >= leasedAt + execution.lease_ttl_seconds * 1000;
}

function executionTransition(task, fromState, toState, reason) {
  const allowed = validateTransition("execution", fromState, toState);
  if (!allowed.valid) {
    fail(allowed.errors);
  }
  return {
    schema_version: "0.5",
    document_kind: "lifecycle_transition",
    mission_id: task.mission_id,
    task_id: task.task_id,
    contract_id: task.contract_id,
    contract_hash: task.contract_hash,
    machine: "execution",
    from_state: fromState,
    to_state: toState,
    reason,
    authority_claim: "none",
  };
}

function taskTransition(task, fromState, toState, reason) {
  if (toState === "COMPLETED" || toState === "APPROVED" || toState === "MERGED" || toState === "MERGE_READY") {
    fail([`recovery cannot transition Task to ${toState}`]);
  }
  const currentBinding = verifyContractBinding(task);
  if (!currentBinding.valid) {
    fail(currentBinding.errors);
  }
  const allowed = validateTransition("task", fromState, toState);
  if (!allowed.valid) {
    fail(allowed.errors);
  }
  let nextTask = clone(task);
  nextTask.state = toState;
  delete nextTask.contract_hash;
  nextTask = stampContractHash(nextTask);
  const binding = verifyContractBinding(nextTask);
  if (!binding.valid) {
    fail(binding.errors);
  }
  const transition = {
    schema_version: "0.5",
    document_kind: "lifecycle_transition",
    mission_id: nextTask.mission_id,
    task_id: nextTask.task_id,
    contract_id: nextTask.contract_id,
    contract_hash: nextTask.contract_hash,
    machine: "task",
    from_state: fromState,
    to_state: toState,
    reason,
    authority_claim: "none",
  };
  return { nextTask, transition };
}

function snapshotOf({ execution, task, transitions, attempt }) {
  return {
    execution_state: execution && execution.state ? execution.state : null,
    task_state: task && task.state ? task.state : null,
    execution_id: execution && execution.execution_id ? execution.execution_id : null,
    task_id: task && task.task_id ? task.task_id : null,
    contract_id: task && task.contract_id ? task.contract_id : null,
    contract_hash: task && task.contract_hash ? task.contract_hash : null,
    transition_suffixes: Array.isArray(transitions)
      ? transitions.map((item) => item.suffix).filter((suffix) => typeof suffix === "string")
      : [],
    runner_attempt_state:
      attempt && typeof attempt.invocation_state === "string" ? attempt.invocation_state : null,
  };
}

function interpretRunnerAttempt(attempt) {
  if (attempt === null || attempt === undefined) {
    return { fact: "NOT_INVOKED", reasons: ["runner attempt identity is absent"] };
  }
  if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)) {
    return { fact: "UNKNOWN", reasons: ["runner attempt document is malformed"] };
  }
  if (attempt.document_kind !== "runner_attempt") {
    return { fact: "UNKNOWN", reasons: ["runner attempt document_kind is invalid"] };
  }
  if (attempt.authority_claim !== "none") {
    return { fact: "UNKNOWN", reasons: ["runner attempt authority_claim is not none"] };
  }
  if (!KNOWN_INVOCATION_STATES.has(attempt.invocation_state)) {
    return {
      fact: "UNKNOWN",
      reasons: [`runner invocation_state is not canonical: ${String(attempt.invocation_state)}`],
    };
  }
  return {
    fact: "INVOKED",
    reasons: [`runner attempt invocation_state=${attempt.invocation_state}`],
    attempt,
  };
}

function hasSuffix(transitions, suffix) {
  return (transitions || []).some((item) => item && item.suffix === suffix);
}

function findGovernedRunEvidence(records, executionId) {
  return (records || []).find(
    (item) =>
      item &&
      item.record_kind === "governed_run_evidence_data" &&
      item.executionId === executionId,
  );
}

function findRecoveryEvidence(records, recoveryId) {
  return (records || []).find(
    (item) => item && item.record_kind === EVIDENCE_KIND && item.recovery_id === recoveryId,
  );
}

class GovernedExecutionRecovery {
  /**
   * @param {{
   *   store: object,
   *   evaluateStartAuthorization?: Function,
   *   evidenceSink?: { putEvidence: Function, listEvidence?: Function, listEvidenceIds?: Function },
   *   clock?: () => Date,
   *   runner?: { run: Function },
   * }} options
   */
  constructor(options = {}) {
    this.store = assertStore(options.store);
    this.evaluateStartAuthorization =
      typeof options.evaluateStartAuthorization === "function"
        ? options.evaluateStartAuthorization
        : null;
    this.evidenceSink =
      options.evidenceSink && typeof options.evidenceSink.putEvidence === "function"
        ? options.evidenceSink
        : new MemoryEvidenceSink();
    this.clock = typeof options.clock === "function" ? options.clock : () => new Date();
    this.runner = options.runner && typeof options.runner.run === "function" ? options.runner : null;
  }

  async #listEvidenceRecords() {
    if (typeof this.evidenceSink.listEvidence === "function") {
      return this.evidenceSink.listEvidence();
    }
    return Array.isArray(this.evidenceSink.records) ? this.evidenceSink.records.slice() : [];
  }

  async #loadEnvelope(executionId) {
    const execution = await this.store.getExecution(executionId);
    if (!execution) {
      return { missing: ["execution"] };
    }
    const task = execution.task_id ? await this.store.getTask(execution.task_id) : null;
    const mission = task && task.mission_id ? await this.store.getMission(task.mission_id) : null;
    const assignment = task && task.task_id ? await this.store.getAssignment(task.task_id) : null;
    const ack = await this.store.getPreExecutionAck(executionId);
    const dispatchPackage = await this.store.getPackage(executionId);
    const transitions =
      typeof this.store.listTransitions === "function"
        ? await this.store.listTransitions(executionId)
        : [];
    const attempt =
      typeof this.store.getRunnerAttempt === "function"
        ? await this.store.getRunnerAttempt(executionId)
        : undefined;
    return {
      execution,
      task,
      mission,
      assignment,
      ack,
      dispatchPackage,
      transitions,
      attempt,
    };
  }

  #classify(envelope, evidenceRecords) {
    const reasons = [];
    const { execution, task, mission, assignment, ack, transitions, attempt } = envelope;

    if (!execution || typeof execution !== "object" || Array.isArray(execution)) {
      return {
        classification: CLASSIFICATION.UNRECOVERABLE,
        reasons: ["malformed or missing execution document"],
      };
    }
    if (!task || typeof task !== "object" || Array.isArray(task)) {
      return {
        classification: CLASSIFICATION.UNRECOVERABLE,
        reasons: ["malformed or missing task document"],
      };
    }

    const execDoc = validateDocument("execution", execution);
    if (!execDoc.valid) {
      return {
        classification: CLASSIFICATION.UNRECOVERABLE,
        reasons: ["malformed execution document", ...execDoc.errors],
      };
    }
    const binding = verifyContractBinding(task);
    if (!binding.valid) {
      return {
        classification: CLASSIFICATION.CORRUPT_BINDING,
        reasons: ["contract hash mismatch", ...binding.errors],
      };
    }
    const taskDoc = validateDocument("task_contract", task);
    if (!taskDoc.valid) {
      const hashRelated = taskDoc.errors.some((item) => /contract_hash/.test(String(item)));
      return {
        classification: hashRelated ? CLASSIFICATION.CORRUPT_BINDING : CLASSIFICATION.UNRECOVERABLE,
        reasons: hashRelated
          ? ["contract hash mismatch", ...taskDoc.errors]
          : ["malformed task document", ...taskDoc.errors],
      };
    }

    if (task.state === "COMPLETED") {
      return {
        classification: CLASSIFICATION.UNRECOVERABLE,
        reasons: ["recovery cannot complete Tasks and cannot accept COMPLETED as a repair target"],
      };
    }

    if (execution.contract_id !== task.contract_id) {
      return {
        classification: CLASSIFICATION.CORRUPT_BINDING,
        reasons: ["contract ID mismatch between execution and task"],
      };
    }
    if (execution.task_id !== task.task_id) {
      return {
        classification: CLASSIFICATION.CORRUPT_BINDING,
        reasons: ["task/execution correlation mismatch for task_id"],
      };
    }
    if (execution.mission_id !== task.mission_id) {
      return {
        classification: CLASSIFICATION.CORRUPT_BINDING,
        reasons: ["task/execution correlation mismatch for mission_id"],
      };
    }

    if (!mission || !assignment) {
      return {
        classification: CLASSIFICATION.UNRECOVERABLE,
        reasons: ["missing canonical documents required to prove correlation"],
      };
    }

    const correlation = validateCorrelation({ mission, task, assignment, execution });
    if (!correlation.valid) {
      return {
        classification: CLASSIFICATION.CORRUPT_BINDING,
        reasons: ["correlation mismatch", ...correlation.errors],
      };
    }

    const invocation =
      attempt === undefined && typeof this.store.getRunnerAttempt !== "function"
        ? { fact: "UNKNOWN", reasons: ["runner attempt identity cannot be read"] }
        : interpretRunnerAttempt(attempt);

    if (
      execution.state === "RUNNING" &&
      task.state === "AUTHORIZED" &&
      invocation.fact === "INVOKED"
    ) {
      return {
        classification: CLASSIFICATION.AMBIGUOUS_RUNNER_INVOCATION,
        reasons: [
          "Execution RUNNING with Task AUTHORIZED contradicts a persisted runner invocation marker",
          ...invocation.reasons,
        ],
      };
    }

    if (invocation.fact === "UNKNOWN") {
      return {
        classification: CLASSIFICATION.AMBIGUOUS_RUNNER_INVOCATION,
        reasons: ["unknown runner invocation state", ...invocation.reasons],
      };
    }

    if (execution.state === "RUNNING" && task.state === "AUTHORIZED") {
      if (invocation.fact !== "NOT_INVOKED") {
        return {
          classification: CLASSIFICATION.AMBIGUOUS_RUNNER_INVOCATION,
          reasons: ["runner invocation is not proven absent for start-partial recovery", ...invocation.reasons],
        };
      }
      if (!ack) {
        return {
          classification: CLASSIFICATION.UNRECOVERABLE,
          reasons: ["missing canonical start authorization evidence (pre-execution ack)"],
        };
      }
      if (ack.execution_id !== execution.execution_id) {
        return {
          classification: CLASSIFICATION.CORRUPT_BINDING,
          reasons: ["ack execution_id does not match execution"],
        };
      }
      if (ack.task_id !== task.task_id) {
        return {
          classification: CLASSIFICATION.CORRUPT_BINDING,
          reasons: ["ack task_id does not match task"],
        };
      }
      if (ack.contract_id !== task.contract_id) {
        return {
          classification: CLASSIFICATION.CORRUPT_BINDING,
          reasons: ["ack contract_id does not match task"],
        };
      }
      if (ack.contract_hash !== task.contract_hash) {
        return {
          classification: CLASSIFICATION.CORRUPT_BINDING,
          reasons: ["contract hash mismatch between ack and authorized task"],
        };
      }
      reasons.push("Execution RUNNING + Task AUTHORIZED with proven non-invocation");
      reasons.push("start authorization evidence is present and bound");
      return {
        classification: CLASSIFICATION.RECOVERABLE_START_PARTIAL,
        reasons,
        invocation,
      };
    }

    if (execution.state === "LEASED" && task.state === "IN_PROGRESS") {
      if (leaseExpired(execution, this.clock())) {
        return {
          classification: CLASSIFICATION.STALE_LEASE,
          reasons: [
            "Task IN_PROGRESS + Execution LEASED requires re-evaluation",
            "lease has expired",
            "recovery must not assume Execution should become RUNNING",
          ],
        };
      }
      return {
        classification: CLASSIFICATION.UNRECOVERABLE,
        reasons: [
          "Task IN_PROGRESS + Execution LEASED is an inverse partial",
          "canonical facts do not prove Execution RUNNING",
          "recovery must not invent a start transition",
        ],
      };
    }

    if (execution.state === "RESULT_SUBMITTED" && task.state === "IN_PROGRESS") {
      const runnerResult = attempt && attempt.runner_result ? attempt.runner_result : null;
      const validation = validateRunnerResult(runnerResult, envelope.validationExpectations || {});
      if (!runnerResult) {
        return {
          classification: CLASSIFICATION.UNRECOVERABLE,
          reasons: [
            "Execution RESULT_SUBMITTED + Task IN_PROGRESS but no canonical runner result is persisted",
            "recovery cannot invent REVIEW_READY",
          ],
        };
      }
      if (runnerResult.executionId !== execution.execution_id) {
        return {
          classification: CLASSIFICATION.CORRUPT_BINDING,
          reasons: ["runner result executionId does not match execution"],
        };
      }
      if (runnerResult.taskId !== task.task_id) {
        return {
          classification: CLASSIFICATION.CORRUPT_BINDING,
          reasons: ["runner result taskId does not match task"],
        };
      }
      if (runnerResult.contractId !== task.contract_id) {
        return {
          classification: CLASSIFICATION.CORRUPT_BINDING,
          reasons: ["runner result contractId does not match task"],
        };
      }
      if (validation.passed !== true) {
        return {
          classification: CLASSIFICATION.UNRECOVERABLE,
          reasons: [
            "independently validated runner result is required to reconcile REVIEW_READY",
            ...validation.findings,
          ],
        };
      }
      reasons.push("Execution RESULT_SUBMITTED + Task IN_PROGRESS");
      reasons.push("independently validated runner result is bound to the same envelope");
      return {
        classification: CLASSIFICATION.RECOVERABLE_RESULT_PARTIAL,
        reasons,
        invocation,
        validation,
      };
    }

    const matchingStart = execution.state === "RUNNING" && task.state === "IN_PROGRESS";
    const matchingResult = execution.state === "RESULT_SUBMITTED" && task.state === "REVIEW_READY";
    const matchingFailed = execution.state === "FAILED" && task.state === "FAILED";
    const matchingLease = execution.state === "LEASED" && (task.state === "AUTHORIZED" || task.state === "READY");

    if (matchingStart) {
      const missingStartTransitions =
        !hasSuffix(transitions, "LEASED-RUNNING") || !hasSuffix(transitions, "AUTHORIZED-IN_PROGRESS");
      if (missingStartTransitions) {
        if (invocation.fact === "UNKNOWN") {
          return {
            classification: CLASSIFICATION.AMBIGUOUS_RUNNER_INVOCATION,
            reasons: ["unknown runner invocation state while start transitions are missing"],
          };
        }
        return {
          classification: CLASSIFICATION.RECOVERABLE_START_PARTIAL,
          reasons: [
            "Task and Execution start states match",
            "missing justified start lifecycle transition(s)",
          ],
          invocation,
        };
      }
      return {
        classification: CLASSIFICATION.CONSISTENT,
        reasons: ["Execution RUNNING and Task IN_PROGRESS are consistent; no recovery repair required"],
        invocation,
      };
    }

    if (matchingResult) {
      const missingResultTransitions =
        !hasSuffix(transitions, "RUNNING-RESULT_SUBMITTED") ||
        !hasSuffix(transitions, "IN_PROGRESS-REVIEW_READY");
      if (missingResultTransitions) {
        return {
          classification: CLASSIFICATION.RECOVERABLE_RESULT_PARTIAL,
          reasons: [
            "Task and Execution result states match",
            "missing justified result lifecycle transition(s)",
          ],
          invocation,
        };
      }
      const existingEvidence = findGovernedRunEvidence(evidenceRecords, execution.execution_id);
      if (!existingEvidence) {
        return {
          classification: CLASSIFICATION.RECOVERABLE_EVIDENCE_MISSING,
          reasons: [
            "canonical RESULT_SUBMITTED / REVIEW_READY is persisted",
            "governed run evidence DATA is missing",
          ],
          invocation,
        };
      }
      return {
        classification: CLASSIFICATION.CONSISTENT,
        reasons: ["Execution RESULT_SUBMITTED and Task REVIEW_READY are consistent"],
        invocation,
      };
    }

    if (matchingFailed || matchingLease) {
      return {
        classification: CLASSIFICATION.CONSISTENT,
        reasons: [`Execution ${execution.state} and Task ${task.state} are consistent`],
        invocation,
      };
    }

    return {
      classification: CLASSIFICATION.UNRECOVERABLE,
      reasons: [
        `incompatible lifecycle states execution=${execution.state} task=${task.state}`,
        "recovery will not infer an unsupported transition",
      ],
    };
  }

  async #persistTransitionIfMissing(transition, executionId, suffix, actions) {
    const existing =
      typeof this.store.getTransition === "function"
        ? await this.store.getTransition(executionId, suffix)
        : null;
    if (existing) {
      actions.push(`transition_present:${suffix}`);
      return false;
    }
    const doc = validateDocument("lifecycle_transition", transition);
    if (!doc.valid) {
      fail(doc.errors);
    }
    await this.store.putTransition(transition, executionId, suffix);
    actions.push(`persist_transition:${suffix}`);
    return true;
  }

  async #repairStartPartial(envelope, actions) {
    const { execution, task, transitions } = envelope;
    if (task.state === "AUTHORIZED") {
      const taskMove = taskTransition(
        task,
        "AUTHORIZED",
        "IN_PROGRESS",
        "Recovery repair of start-partial persist. IN_PROGRESS is not completion approval.",
      );
      const taskDoc = validateDocument("task_contract", taskMove.nextTask);
      if (!taskDoc.valid) {
        fail(taskDoc.errors);
      }
      await this.store.putTask(taskMove.nextTask);
      actions.push("persist_task_IN_PROGRESS");
      await this.#persistTransitionIfMissing(
        taskMove.transition,
        execution.execution_id,
        "AUTHORIZED-IN_PROGRESS",
        actions,
      );
    } else {
      actions.push("task_already_IN_PROGRESS");
    }

    const execTransition = executionTransition(
      task,
      "LEASED",
      "RUNNING",
      "Recovery repair of start-partial persist. RUNNING is not completion, GitHub approval, or merge.",
    );
    await this.#persistTransitionIfMissing(
      execTransition,
      execution.execution_id,
      "LEASED-RUNNING",
      actions,
    );

    if (task.state === "IN_PROGRESS" && !hasSuffix(transitions, "AUTHORIZED-IN_PROGRESS")) {
      const transition = {
        schema_version: "0.5",
        document_kind: "lifecycle_transition",
        mission_id: task.mission_id,
        task_id: task.task_id,
        contract_id: task.contract_id,
        contract_hash: task.contract_hash,
        machine: "task",
        from_state: "AUTHORIZED",
        to_state: "IN_PROGRESS",
        reason: "Recovery repair of missing start transition. IN_PROGRESS is not completion approval.",
        authority_claim: "none",
      };
      const allowed = validateTransition("task", "AUTHORIZED", "IN_PROGRESS");
      if (!allowed.valid) {
        fail(allowed.errors);
      }
      await this.#persistTransitionIfMissing(
        transition,
        execution.execution_id,
        "AUTHORIZED-IN_PROGRESS",
        actions,
      );
    }
  }

  async #repairResultPartial(envelope, actions) {
    const { execution, task } = envelope;
    if (task.state === "IN_PROGRESS") {
      const taskMove = taskTransition(
        task,
        "IN_PROGRESS",
        "REVIEW_READY",
        "Recovery repair of result-partial persist. REVIEW_READY is not completion, GitHub approval, or merge.",
      );
      const taskDoc = validateDocument("task_contract", taskMove.nextTask);
      if (!taskDoc.valid) {
        fail(taskDoc.errors);
      }
      await this.store.putTask(taskMove.nextTask);
      actions.push("persist_task_REVIEW_READY");
      await this.#persistTransitionIfMissing(
        taskMove.transition,
        execution.execution_id,
        "IN_PROGRESS-REVIEW_READY",
        actions,
      );
    } else {
      actions.push("task_already_REVIEW_READY");
    }

    const persistedTask = await this.store.getTask(task.task_id);
    const execTransition = executionTransition(
      persistedTask,
      "RUNNING",
      "RESULT_SUBMITTED",
      "Recovery repair of result-partial persist. RESULT_SUBMITTED is a reviewable execution result, not Task completion.",
    );
    await this.#persistTransitionIfMissing(
      execTransition,
      execution.execution_id,
      "RUNNING-RESULT_SUBMITTED",
      actions,
    );

    if (task.state === "REVIEW_READY") {
      const transition = {
        schema_version: "0.5",
        document_kind: "lifecycle_transition",
        mission_id: persistedTask.mission_id,
        task_id: persistedTask.task_id,
        contract_id: persistedTask.contract_id,
        contract_hash: persistedTask.contract_hash,
        machine: "task",
        from_state: "IN_PROGRESS",
        to_state: "REVIEW_READY",
        reason:
          "Recovery repair of missing result transition. REVIEW_READY is not completion, GitHub approval, or merge.",
        authority_claim: "none",
      };
      await this.#persistTransitionIfMissing(
        transition,
        execution.execution_id,
        "IN_PROGRESS-REVIEW_READY",
        actions,
      );
    }
  }

  async #regenerateRunEvidence(envelope, actions) {
    const { execution, task, ack, dispatchPackage, attempt } = envelope;
    const records = await this.#listEvidenceRecords();
    if (findGovernedRunEvidence(records, execution.execution_id)) {
      actions.push("governed_run_evidence_present");
      return;
    }
    const existingIds =
      this.evidenceSink && typeof this.evidenceSink.listEvidenceIds === "function"
        ? await this.evidenceSink.listEvidenceIds()
        : [];
    const evidenceId = nextEvidenceId(this.clock, existingIds);
    const runnerResult = attempt && attempt.runner_result ? attempt.runner_result : {};
    const validation = validateRunnerResult(runnerResult, {});
    const evidence = buildGovernedRunEvidence({
      evidenceId,
      task,
      execution,
      ack,
      dispatchPackage,
      runnerResult,
      validation,
      expectations: {},
      canonicalMainSha: execution.base_sha,
      transitionPersisted: true,
    });
    await this.evidenceSink.putEvidence(evidence);
    actions.push("regenerate_governed_run_evidence_data");
  }

  async #putRecoveryEvidence(result) {
    const records = await this.#listEvidenceRecords();
    if (findRecoveryEvidence(records, result.recovery_id)) {
      return result.evidence;
    }
    await this.evidenceSink.putEvidence(result.evidence);
    return result.evidence;
  }

  #buildResult({
    execution,
    task,
    classification,
    reasons,
    observedBefore,
    actions,
    persistedAfter,
    ignoredCallerFlags,
  }) {
    const decisionReasons = reasons.slice();
    if (ignoredCallerFlags.length) {
      decisionReasons.push(
        `ignored non-authoritative caller flags: ${ignoredCallerFlags.join(", ")}`,
      );
    }
    decisionReasons.push("authority_claim=none");
    decisionReasons.push("recovery does not invoke runner");
    const result = {
      schema_version: SCHEMA_VERSION,
      record_kind: RECORD_KIND,
      recovery_id: recoveryIdFor(execution.execution_id),
      execution_id: execution.execution_id,
      task_id: task.task_id,
      contract_id: task.contract_id,
      contract_hash: task.contract_hash,
      classification,
      outcome: BLOCKED_CLASSIFICATIONS.has(classification) ? "BLOCKED" : "PASS",
      observed_state_before: observedBefore,
      actions_attempted: actions.slice(),
      persisted_state_after: persistedAfter,
      runner_invoked: false,
      decision_reasons: decisionReasons,
      authority_claim: "none",
      taskCompletionAuthorized: false,
      evidenceAuthority: false,
    };
    result.evidence = {
      schema_version: SCHEMA_VERSION,
      record_kind: EVIDENCE_KIND,
      recovery_id: result.recovery_id,
      execution_id: result.execution_id,
      task_id: result.task_id,
      contract_id: result.contract_id,
      contract_hash: result.contract_hash,
      observed_state_before: clone(observedBefore),
      classification,
      actions_attempted: actions.slice(),
      persisted_state_after: clone(persistedAfter),
      runner_invoked: false,
      decision_reasons: decisionReasons.slice(),
      authority_claim: "none",
      evidenceAuthority: false,
      lifecycleAuthority: false,
      taskCompletionAuthorized: false,
    };
    return result;
  }

  async recoverGovernedExecution(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      fail(["recoverGovernedExecution input must be an object"]);
    }
    if (typeof input.execution_id !== "string") {
      fail(["recoverGovernedExecution requires execution_id"]);
    }
    assertCanonicalId("EXEC", input.execution_id);

    const ignoredCallerFlags = ["force", "allowed", "passed", "recover"].filter((key) =>
      Object.prototype.hasOwnProperty.call(input, key),
    );

    if (this.runner) {
      // Intentionally never invoked. Presence of a runner is not a recovery path.
    }

    const loaded = await this.#loadEnvelope(input.execution_id);
    if (loaded.missing) {
      fail([`missing canonical documents required to prove state: ${loaded.missing.join(", ")}`]);
    }

    const observedBefore = snapshotOf(loaded);
    const evidenceRecords = await this.#listEvidenceRecords();
    loaded.validationExpectations = input.validationExpectations || {};
    const classified = this.#classify(loaded, evidenceRecords);
    const actions = [];

    if (BLOCKED_CLASSIFICATIONS.has(classified.classification)) {
      const blocked = this.#buildResult({
        execution: loaded.execution,
        task: loaded.task,
        classification: classified.classification,
        reasons: classified.reasons,
        observedBefore,
        actions: ["none"],
        persistedAfter: observedBefore,
        ignoredCallerFlags,
      });
      await this.#putRecoveryEvidence(blocked);
      return blocked;
    }

    try {
      if (classified.classification === CLASSIFICATION.RECOVERABLE_START_PARTIAL) {
        await this.#repairStartPartial(loaded, actions);
      } else if (classified.classification === CLASSIFICATION.RECOVERABLE_RESULT_PARTIAL) {
        await this.#repairResultPartial(loaded, actions);
      } else if (classified.classification === CLASSIFICATION.RECOVERABLE_EVIDENCE_MISSING) {
        await this.#regenerateRunEvidence(loaded, actions);
      } else {
        actions.push("none");
      }
    } catch (err) {
      const afterFailure = await this.#loadEnvelope(input.execution_id);
      const persistedAfter = snapshotOf(afterFailure);
      fail([
        `recovery persistence failed: ${err instanceof Error ? err.message : "unknown persist error"}`,
        `execution_state=${persistedAfter.execution_state}`,
        `task_state=${persistedAfter.task_state}`,
      ]);
    }

    const after = await this.#loadEnvelope(input.execution_id);
    if (after.task && after.task.state === "COMPLETED") {
      fail(["recovery persisted Task COMPLETED which is forbidden"]);
    }
    const persistedAfter = snapshotOf(after);
    const result = this.#buildResult({
      execution: after.execution,
      task: after.task,
      classification: classified.classification,
      reasons: classified.reasons,
      observedBefore,
      actions: actions.length ? actions : ["none"],
      persistedAfter,
      ignoredCallerFlags,
    });
    await this.#putRecoveryEvidence(result);
    return result;
  }
}

module.exports = {
  GovernedExecutionRecovery,
  CLASSIFICATION,
  SCHEMA_VERSION,
};
