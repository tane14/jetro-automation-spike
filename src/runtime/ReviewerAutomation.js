"use strict";

/**
 * Reviewer Automation v1.6.
 *
 * Creates a deterministic review request bound to an exact implementation HEAD,
 * dispatches through an injected adapter, and independently validates the result.
 *
 * Adapter output is transport only. Structured fields, not prose, drive classification.
 * Does not grant merge, GitHub approval, Task completion, policy, or evidence authority.
 * Fake adapter only in this slice. FAIL_CLOSED=YES. EVIDENCE_AUTHORITY=NO.
 */

const {
  stampContractHash,
  verifyContractBinding,
  validateCorrelation,
  validateTransition,
  validateDocument,
} = require("../contracts");
const { assertStore } = require("./MissionTaskStore");
const { assertCanonicalId } = require("./ids");
const { RuntimeValidationError } = require("./MissionTaskRuntime");
const { MemoryEvidenceSink } = require("./GovernedExecutionRuntime");
const { ReviewerAdapter } = require("./ReviewerAdapter");

const SCHEMA_VERSION = "1.6-reviewer-automation";
const HANDOFF_KIND = "review_handoff";
const RESULT_KIND = "review_result";
const EVIDENCE_KIND = "reviewer_automation_evidence_data";
const GIT_SHA = /^[a-f0-9]{40}$/;
const ALLOWED_VERDICTS = new Set(["PASS", "PASS_WITH_QUALIFICATIONS", "REQUEST_CHANGES", "BLOCKED"]);
const FORBIDDEN_AUTHORITY_TRUE = [
  "merge_authorized",
  "merge_authority",
  "github_approval",
  "github_approved",
  "taskCompletionAuthorized",
  "task_completion_authorized",
  "completion_authorized",
  "substitutes_for_github_review",
  "evidenceAuthority",
  "lifecycleAuthority",
];

const CLASSIFICATION = {
  REVIEW_NOT_REQUESTED: "REVIEW_NOT_REQUESTED",
  REVIEW_REQUESTED: "REVIEW_REQUESTED",
  REVIEW_RESULT_ACCEPTED: "REVIEW_RESULT_ACCEPTED",
  REVIEW_RESULT_STALE_HEAD: "REVIEW_RESULT_STALE_HEAD",
  CORRUPT_REVIEW_BINDING: "CORRUPT_REVIEW_BINDING",
  REVIEWER_IDENTITY_CONFLICT: "REVIEWER_IDENTITY_CONFLICT",
  REVIEW_RESULT_INVALID: "REVIEW_RESULT_INVALID",
  REVIEW_PROVIDER_FAILED: "REVIEW_PROVIDER_FAILED",
  REVIEW_BLOCKED: "REVIEW_BLOCKED",
};

const BLOCKED_CLASSIFICATIONS = new Set([
  CLASSIFICATION.REVIEW_NOT_REQUESTED,
  CLASSIFICATION.REVIEW_RESULT_STALE_HEAD,
  CLASSIFICATION.CORRUPT_REVIEW_BINDING,
  CLASSIFICATION.REVIEWER_IDENTITY_CONFLICT,
  CLASSIFICATION.REVIEW_RESULT_INVALID,
  CLASSIFICATION.REVIEW_PROVIDER_FAILED,
  CLASSIFICATION.REVIEW_BLOCKED,
]);

function fail(errors) {
  throw new RuntimeValidationError(errors);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isoNow(clock) {
  return clock().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function identityKey(value) {
  if (typeof value === "string") {
    return value.toLowerCase();
  }
  if (value && typeof value === "object" && typeof value.identity === "string") {
    return value.identity.toLowerCase();
  }
  return null;
}

function collectExecutorIdentities({ task, assignment, execution }) {
  const found = [];
  for (const actor of [task && task.assigned_to, assignment && assignment.assigned_to, execution && execution.assigned_to]) {
    const key = identityKey(actor);
    if (key) {
      found.push(key);
    }
  }
  return found;
}

function reviewIdFor(executionId, implementationHeadSha) {
  return `REV-${executionId}-${implementationHeadSha}`;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

class ReviewerAutomation {
  /**
   * @param {{
   *   store: object,
   *   reviewerAdapter?: { review: Function },
   *   evidenceSink?: { putEvidence: Function, listEvidence?: Function },
   *   clock?: () => Date,
   * }} options
   */
  constructor(options = {}) {
    this.store = assertStore(options.store);
    this.reviewerAdapter =
      options.reviewerAdapter && typeof options.reviewerAdapter.review === "function"
        ? options.reviewerAdapter
        : null;
    this.evidenceSink =
      options.evidenceSink && typeof options.evidenceSink.putEvidence === "function"
        ? options.evidenceSink
        : new MemoryEvidenceSink();
    this.clock = typeof options.clock === "function" ? options.clock : () => new Date();
  }

  #requireReviewStore() {
    if (typeof this.store.putReviewHandoff !== "function" || typeof this.store.getReviewHandoff !== "function") {
      fail(["review handoff persistence is required"]);
    }
    if (typeof this.store.putReviewResult !== "function" || typeof this.store.getReviewResult !== "function") {
      fail(["review result persistence is required"]);
    }
  }

  async #loadCanonical(executionId) {
    const execution = await this.store.getExecution(executionId);
    if (!execution) {
      return { missing: ["execution"] };
    }
    const task = execution.task_id ? await this.store.getTask(execution.task_id) : null;
    const mission = task && task.mission_id ? await this.store.getMission(task.mission_id) : null;
    const assignment = task && task.task_id ? await this.store.getAssignment(task.task_id) : null;
    return { execution, task, mission, assignment };
  }

  #bindingErrors(bundle, extraDocs) {
    const { execution, task, mission, assignment } = bundle;
    const reasons = [];
    if (!execution || !task) {
      return ["missing canonical Task or Execution"];
    }
    const binding = verifyContractBinding(task);
    if (!binding.valid) {
      reasons.push("contract hash mismatch", ...binding.errors);
    }
    if (execution.contract_id !== task.contract_id) {
      reasons.push("contract ID mismatch between execution and task");
    }
    if (execution.task_id !== task.task_id) {
      reasons.push("task/execution correlation mismatch for task_id");
    }
    if (execution.mission_id !== task.mission_id) {
      reasons.push("task/execution correlation mismatch for mission_id");
    }
    if (!mission || !assignment) {
      reasons.push("missing canonical documents required to prove correlation");
    } else {
      const correlation = validateCorrelation({
        mission,
        task,
        assignment,
        execution,
        ...extraDocs,
      });
      if (!correlation.valid) {
        reasons.push("correlation mismatch", ...correlation.errors);
      }
    }
    return reasons;
  }

  #assertHeadSha(value, label) {
    if (typeof value !== "string" || !GIT_SHA.test(value)) {
      return [`${label} is missing or not an exact git SHA`];
    }
    return [];
  }

  #authorityViolations(doc) {
    const reasons = [];
    if (!doc || typeof doc !== "object") {
      return ["document missing"];
    }
    if (Object.prototype.hasOwnProperty.call(doc, "authority_claim") && doc.authority_claim !== "none") {
      reasons.push(`authority_claim ${JSON.stringify(doc.authority_claim)} is not none`);
    }
    for (const key of FORBIDDEN_AUTHORITY_TRUE) {
      if (doc[key] === true) {
        reasons.push(`attempt to claim forbidden authority via ${key}`);
      }
    }
    if (doc.verdict === "APPROVED" || doc.verdict === "COMPLETED" || doc.verdict === "MERGED") {
      reasons.push(`verdict ${doc.verdict} claims approval/completion/merge authority`);
    }
    return reasons;
  }

  #buildResult({
    classification,
    reasons,
    execution,
    task,
    handoff,
    result,
    actions,
    observedBefore,
    persistedAfter,
    provider_executed,
  }) {
    const decisionReasons = (reasons || []).slice();
    decisionReasons.push("authority_claim=none");
    decisionReasons.push("reviewer output is not GitHub approval, merge, or Task completion");
    const outcome = BLOCKED_CLASSIFICATIONS.has(classification) ? "BLOCKED" : "PASS";
    const reviewId = (handoff && handoff.review_id) || (result && result.review_id) || null;
    const payload = {
      schema_version: SCHEMA_VERSION,
      record_kind: "reviewer_automation_result",
      classification,
      outcome,
      review_id: reviewId,
      mission_id: task && task.mission_id,
      task_id: task && task.task_id,
      execution_id: execution && execution.execution_id,
      contract_id: task && task.contract_id,
      contract_hash: task && task.contract_hash,
      implementation_head_sha: handoff && handoff.implementation_head_sha,
      reviewed_head_sha: result && result.reviewed_head_sha,
      reviewer_identity: result && result.reviewer_identity,
      reviewer_class: (result && (result.reviewer_class || result.provider)) || (handoff && handoff.reviewer_class) || null,
      validated_verdict: result && ALLOWED_VERDICTS.has(result.verdict) ? result.verdict : null,
      findings: result && Array.isArray(result.findings) ? clone(result.findings) : [],
      qualifications: result && Array.isArray(result.qualifications) ? clone(result.qualifications) : [],
      observed_state_before: observedBefore,
      persisted_state_after: persistedAfter,
      actions_attempted: actions && actions.length ? actions.slice() : ["none"],
      provider_executed: provider_executed === true,
      runner_invoked: false,
      decision_reasons: decisionReasons,
      authority_claim: "none",
      taskCompletionAuthorized: false,
      evidenceAuthority: false,
      githubApprovalAuthority: false,
      mergeAuthorized: false,
      review_handoff: handoff ? clone(handoff) : null,
      review_result: result ? clone(result) : null,
    };
    payload.evidence = {
      schema_version: SCHEMA_VERSION,
      record_kind: EVIDENCE_KIND,
      review_id: payload.review_id,
      mission_id: payload.mission_id,
      task_id: payload.task_id,
      execution_id: payload.execution_id,
      contract_id: payload.contract_id,
      contract_hash: payload.contract_hash,
      implementation_head_sha: payload.implementation_head_sha,
      reviewer_identity: payload.reviewer_identity,
      reviewer_class: payload.reviewer_class,
      validated_verdict: payload.validated_verdict,
      findings_count: payload.findings.length,
      qualifications_count: payload.qualifications.length,
      review_state_before: observedBefore,
      review_state_after: persistedAfter,
      provider_execution_fact: payload.provider_executed,
      authority_claim: "none",
      evidenceAuthority: false,
      taskCompletionAuthorized: false,
    };
    return payload;
  }

  async #putEvidence(result) {
    const records =
      typeof this.evidenceSink.listEvidence === "function"
        ? await this.evidenceSink.listEvidence()
        : Array.isArray(this.evidenceSink.records)
          ? this.evidenceSink.records
          : [];
    const exists = records.some(
      (item) =>
        item &&
        item.record_kind === EVIDENCE_KIND &&
        item.review_id === result.review_id &&
        item.validated_verdict === result.validated_verdict &&
        item.implementation_head_sha === result.implementation_head_sha,
    );
    if (!exists) {
      await this.evidenceSink.putEvidence(result.evidence);
    }
    return result;
  }

  async #observe(executionId, reviewId) {
    const task = executionId
      ? await this.store.getTask((await this.store.getExecution(executionId)).task_id)
      : null;
    const execution = executionId ? await this.store.getExecution(executionId) : null;
    const handoff = reviewId ? await this.store.getReviewHandoff(reviewId) : null;
    const result = reviewId ? await this.store.getReviewResult(reviewId) : null;
    return {
      task_state: task && task.state,
      execution_state: execution && execution.state,
      review_handoff_present: Boolean(handoff),
      review_result_present: Boolean(result),
      implementation_head_sha: handoff && handoff.implementation_head_sha,
      reviewed_head_sha: result && result.reviewed_head_sha,
      verdict: result && result.verdict,
    };
  }

  async requestReview(input = {}) {
    this.#requireReviewStore();
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      fail(["requestReview input must be an object"]);
    }
    if (typeof input.execution_id !== "string") {
      fail(["requestReview requires execution_id"]);
    }
    assertCanonicalId("EXEC", input.execution_id);

    const loaded = await this.#loadCanonical(input.execution_id);
    if (loaded.missing) {
      const blocked = this.#buildResult({
        classification: CLASSIFICATION.REVIEW_BLOCKED,
        reasons: [`missing canonical documents: ${loaded.missing.join(", ")}`],
        execution: null,
        task: null,
        actions: ["none"],
        observedBefore: { review_handoff_present: false },
        persistedAfter: { review_handoff_present: false },
        provider_executed: false,
      });
      return blocked;
    }

    const headErrors = this.#assertHeadSha(input.implementation_head_sha, "implementation_head_sha");
    const bindingErrors = this.#bindingErrors(loaded);
    const requestedIdentity =
      typeof input.requested_reviewer_identity === "string"
        ? input.requested_reviewer_identity
        : typeof input.reviewer_identity === "string"
          ? input.reviewer_identity
          : "claude-reviewer-lab";
    const reviewerClass =
      typeof input.reviewer_class === "string"
        ? input.reviewer_class
        : typeof input.provider === "string"
          ? input.provider
          : "fake_reviewer";

    if (headErrors.length) {
      const blocked = this.#buildResult({
        classification: CLASSIFICATION.REVIEW_BLOCKED,
        reasons: headErrors,
        execution: loaded.execution,
        task: loaded.task,
        actions: ["none"],
        observedBefore: { task_state: loaded.task.state },
        persistedAfter: { task_state: loaded.task.state },
        provider_executed: false,
      });
      await this.#putEvidence(blocked);
      return blocked;
    }
    if (bindingErrors.length) {
      const blocked = this.#buildResult({
        classification: CLASSIFICATION.CORRUPT_REVIEW_BINDING,
        reasons: bindingErrors,
        execution: loaded.execution,
        task: loaded.task,
        actions: ["none"],
        observedBefore: { task_state: loaded.task.state },
        persistedAfter: { task_state: loaded.task.state },
        provider_executed: false,
      });
      await this.#putEvidence(blocked);
      return blocked;
    }

    const executors = collectExecutorIdentities(loaded);
    if (executors.includes(identityKey(requestedIdentity))) {
      const blocked = this.#buildResult({
        classification: CLASSIFICATION.REVIEWER_IDENTITY_CONFLICT,
        reasons: ["requested reviewer identity equals executor identity"],
        execution: loaded.execution,
        task: loaded.task,
        actions: ["none"],
        observedBefore: { task_state: loaded.task.state },
        persistedAfter: { task_state: loaded.task.state },
        provider_executed: false,
      });
      await this.#putEvidence(blocked);
      return blocked;
    }

    const reviewId = reviewIdFor(input.execution_id, input.implementation_head_sha);
    const existing = await this.store.getReviewHandoff(reviewId);
    const executorIdentity =
      (loaded.execution.assigned_to && loaded.execution.assigned_to.identity) ||
      (loaded.task.assigned_to && loaded.task.assigned_to.identity) ||
      "unknown-executor";

    const handoff = {
      schema_version: SCHEMA_VERSION,
      document_kind: HANDOFF_KIND,
      review_id: reviewId,
      mission_id: loaded.task.mission_id,
      task_id: loaded.task.task_id,
      execution_id: loaded.execution.execution_id,
      contract_id: loaded.task.contract_id,
      contract_hash: loaded.task.contract_hash,
      implementation_head_sha: input.implementation_head_sha,
      executor_identity: executorIdentity,
      requested_reviewer_identity: requestedIdentity,
      reviewer_class: reviewerClass,
      review_scope: typeof input.review_scope === "string" ? input.review_scope : "implementation_head_technical_review",
      required_checks: Array.isArray(input.required_checks)
        ? input.required_checks.slice()
        : ["exact_head_binding", "contract_correlation", "reviewer_executor_separation"],
      created_at: existing && existing.created_at ? existing.created_at : isoNow(this.clock),
      authority_claim: "none",
    };

    const actions = [];
    if (
      existing &&
      existing.implementation_head_sha === handoff.implementation_head_sha &&
      existing.contract_hash === handoff.contract_hash &&
      existing.review_id === handoff.review_id &&
      existing.requested_reviewer_identity === handoff.requested_reviewer_identity
    ) {
      actions.push("review_handoff_present");
    } else {
      await this.store.putReviewHandoff(reviewId, handoff);
      actions.push(existing ? "persist_review_handoff" : "persist_review_handoff");
    }

    const persisted = await this.store.getReviewHandoff(reviewId);
    const out = this.#buildResult({
      classification: CLASSIFICATION.REVIEW_REQUESTED,
      reasons: ["deterministic review request bound to exact implementation HEAD"],
      execution: loaded.execution,
      task: loaded.task,
      handoff: persisted,
      actions,
      observedBefore: { review_handoff_present: Boolean(existing), task_state: loaded.task.state },
      persistedAfter: { review_handoff_present: true, task_state: loaded.task.state },
      provider_executed: false,
    });
    await this.#putEvidence(out);
    return out;
  }

  #validateIngest(handoff, rawResult, loaded) {
    if (!rawResult || typeof rawResult !== "object" || Array.isArray(rawResult)) {
      return { classification: CLASSIFICATION.REVIEW_RESULT_INVALID, reasons: ["malformed review result"] };
    }
    if (rawResult.document_kind !== RESULT_KIND) {
      return { classification: CLASSIFICATION.REVIEW_RESULT_INVALID, reasons: ["review result document_kind is invalid"] };
    }

    const authority = this.#authorityViolations(rawResult);
    if (authority.length) {
      return { classification: CLASSIFICATION.REVIEW_BLOCKED, reasons: authority };
    }

    const headErrors = this.#assertHeadSha(rawResult.reviewed_head_sha, "reviewed_head_sha");
    if (headErrors.length) {
      return { classification: CLASSIFICATION.REVIEW_RESULT_INVALID, reasons: headErrors };
    }
    if (rawResult.reviewed_head_sha !== handoff.implementation_head_sha) {
      return {
        classification: CLASSIFICATION.REVIEW_RESULT_STALE_HEAD,
        reasons: [
          "reviewed_head_sha does not equal implementation_head_sha",
          `handoff_head=${handoff.implementation_head_sha}`,
          `result_head=${rawResult.reviewed_head_sha}`,
        ],
      };
    }

    if (rawResult.review_id !== handoff.review_id) {
      return {
        classification: CLASSIFICATION.CORRUPT_REVIEW_BINDING,
        reasons: ["review result review_id does not match review_handoff"],
      };
    }
    if (rawResult.execution_id !== handoff.execution_id || rawResult.execution_id !== loaded.execution.execution_id) {
      return {
        classification: CLASSIFICATION.CORRUPT_REVIEW_BINDING,
        reasons: ["review result execution_id does not match execution"],
      };
    }
    if (rawResult.task_id !== handoff.task_id || rawResult.task_id !== loaded.task.task_id) {
      return {
        classification: CLASSIFICATION.CORRUPT_REVIEW_BINDING,
        reasons: ["review result task_id does not match task"],
      };
    }
    if (rawResult.mission_id !== handoff.mission_id) {
      return {
        classification: CLASSIFICATION.CORRUPT_REVIEW_BINDING,
        reasons: ["review result mission_id does not match"],
      };
    }
    if (rawResult.contract_id !== handoff.contract_id) {
      return {
        classification: CLASSIFICATION.CORRUPT_REVIEW_BINDING,
        reasons: ["contract ID mismatch"],
      };
    }
    if (rawResult.contract_hash !== handoff.contract_hash) {
      return {
        classification: CLASSIFICATION.CORRUPT_REVIEW_BINDING,
        reasons: ["contract hash mismatch"],
      };
    }

    if (!ALLOWED_VERDICTS.has(rawResult.verdict)) {
      return {
        classification: CLASSIFICATION.REVIEW_RESULT_INVALID,
        reasons: [`unknown verdict: ${String(rawResult.verdict)}`],
      };
    }

    const reviewerIdentity = rawResult.reviewer_identity;
    if (typeof reviewerIdentity !== "string" || !reviewerIdentity) {
      return {
        classification: CLASSIFICATION.REVIEW_RESULT_INVALID,
        reasons: ["reviewer_identity is required; provider label is not identity proof"],
      };
    }
    const executors = collectExecutorIdentities(loaded);
    if (executors.includes(identityKey(reviewerIdentity)) || identityKey(reviewerIdentity) === identityKey(handoff.executor_identity)) {
      return {
        classification: CLASSIFICATION.REVIEWER_IDENTITY_CONFLICT,
        reasons: ["reviewer identity equals executor identity"],
      };
    }
    if (
      typeof handoff.requested_reviewer_identity === "string" &&
      identityKey(reviewerIdentity) !== identityKey(handoff.requested_reviewer_identity)
    ) {
      return {
        classification: CLASSIFICATION.REVIEWER_IDENTITY_CONFLICT,
        reasons: ["review result reviewer_identity does not match requested_reviewer_identity"],
      };
    }

    const resultClass = rawResult.reviewer_class || rawResult.provider;
    if (typeof handoff.reviewer_class === "string" && resultClass && resultClass !== handoff.reviewer_class) {
      return {
        classification: CLASSIFICATION.CORRUPT_REVIEW_BINDING,
        reasons: ["review result reviewer_class/provider does not match requested reviewer_class"],
      };
    }

    const reasons = [];
    if (rawResult.findings !== undefined && !Array.isArray(rawResult.findings)) {
      reasons.push("findings must be an array");
    }
    if (rawResult.qualifications !== undefined && !Array.isArray(rawResult.qualifications)) {
      reasons.push("qualifications must be an array");
    }
    if (
      rawResult.tests_or_evidence_considered !== undefined &&
      !Array.isArray(rawResult.tests_or_evidence_considered)
    ) {
      reasons.push("tests_or_evidence_considered must be an array");
    }
    if (reasons.length) {
      return { classification: CLASSIFICATION.REVIEW_RESULT_INVALID, reasons };
    }

    return { classification: CLASSIFICATION.REVIEW_RESULT_ACCEPTED, reasons: ["structured review result independently validated"] };
  }

  #canonicalResult(handoff, rawResult) {
    return {
      schema_version: SCHEMA_VERSION,
      document_kind: RESULT_KIND,
      review_id: handoff.review_id,
      mission_id: handoff.mission_id,
      task_id: handoff.task_id,
      execution_id: handoff.execution_id,
      contract_id: handoff.contract_id,
      contract_hash: handoff.contract_hash,
      reviewed_head_sha: rawResult.reviewed_head_sha,
      reviewer_identity: rawResult.reviewer_identity,
      reviewer_class: rawResult.reviewer_class || rawResult.provider || handoff.reviewer_class,
      provider: rawResult.provider || rawResult.reviewer_class || handoff.reviewer_class,
      verdict: rawResult.verdict,
      findings: Array.isArray(rawResult.findings) ? clone(rawResult.findings) : [],
      qualifications: Array.isArray(rawResult.qualifications) ? clone(rawResult.qualifications) : [],
      tests_or_evidence_considered: Array.isArray(rawResult.tests_or_evidence_considered)
        ? clone(rawResult.tests_or_evidence_considered)
        : [],
      submitted_at: typeof rawResult.submitted_at === "string" ? rawResult.submitted_at : isoNow(this.clock),
      authority_claim: "none",
    };
  }

  async #maybeTransitionTask(loaded, verdict, actions, executionId) {
    const task = loaded.task;
    if (task.state !== "REVIEW_READY") {
      actions.push("task_state_unchanged");
      return task;
    }
    let toState = null;
    if (verdict === "PASS" || verdict === "PASS_WITH_QUALIFICATIONS") {
      toState = "REVIEWED";
    } else if (verdict === "REQUEST_CHANGES") {
      toState = "CHANGES_REQUESTED";
    } else {
      actions.push("task_state_unchanged");
      return task;
    }
    if (toState === "COMPLETED" || toState === "APPROVED" || toState === "MERGED" || toState === "MERGE_READY") {
      fail(["reviewer automation cannot transition Task to completion/approval/merge"]);
    }
    const allowed = validateTransition("task", "REVIEW_READY", toState);
    if (!allowed.valid) {
      actions.push("task_state_unchanged");
      return task;
    }
    const currentBinding = verifyContractBinding(task);
    if (!currentBinding.valid) {
      fail(currentBinding.errors);
    }
    let nextTask = clone(task);
    nextTask.state = toState;
    delete nextTask.contract_hash;
    nextTask = stampContractHash(nextTask);
    const binding = verifyContractBinding(nextTask);
    if (!binding.valid) {
      fail(binding.errors);
    }
    const taskDoc = validateDocument("task_contract", nextTask);
    if (!taskDoc.valid) {
      fail(taskDoc.errors);
    }
    const suffix = `REVIEW_READY-${toState}`;
    const existing =
      typeof this.store.getTransition === "function" ? await this.store.getTransition(executionId, suffix) : null;
    await this.store.putTask(nextTask);
    actions.push(`persist_task_${toState}`);
    if (!existing) {
      const transition = {
        schema_version: "0.5",
        document_kind: "lifecycle_transition",
        mission_id: nextTask.mission_id,
        task_id: nextTask.task_id,
        contract_id: nextTask.contract_id,
        contract_hash: nextTask.contract_hash,
        machine: "task",
        from_state: "REVIEW_READY",
        to_state: toState,
        reason: "Reviewer automation technical assessment only. Not completion, GitHub approval, or merge.",
        authority_claim: "none",
      };
      await this.store.putTransition(transition, executionId, suffix);
      actions.push(`persist_transition:${suffix}`);
    } else {
      actions.push(`transition_present:${suffix}`);
    }
    return nextTask;
  }

  async ingestReviewResult(input = {}) {
    this.#requireReviewStore();
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      fail(["ingestReviewResult input must be an object"]);
    }
    if (typeof input.execution_id !== "string") {
      fail(["ingestReviewResult requires execution_id"]);
    }
    assertCanonicalId("EXEC", input.execution_id);

    const loaded = await this.#loadCanonical(input.execution_id);
    if (loaded.missing || !loaded.task || !loaded.execution) {
      return this.#buildResult({
        classification: CLASSIFICATION.REVIEW_BLOCKED,
        reasons: ["missing canonical Task or Execution"],
        actions: ["none"],
        observedBefore: {},
        persistedAfter: {},
        provider_executed: false,
      });
    }

    const intendedHead = input.implementation_head_sha || (input.result && input.result.reviewed_head_sha);
    const headErrors = this.#assertHeadSha(intendedHead, "implementation_head_sha");
    if (headErrors.length) {
      const blocked = this.#buildResult({
        classification: CLASSIFICATION.REVIEW_BLOCKED,
        reasons: headErrors,
        execution: loaded.execution,
        task: loaded.task,
        actions: ["none"],
        observedBefore: { task_state: loaded.task.state },
        persistedAfter: { task_state: loaded.task.state },
        provider_executed: false,
      });
      await this.#putEvidence(blocked);
      return blocked;
    }

    const reviewId = reviewIdFor(input.execution_id, intendedHead);
    const handoff = await this.store.getReviewHandoff(reviewId);
    if (!handoff) {
      const blocked = this.#buildResult({
        classification: CLASSIFICATION.REVIEW_NOT_REQUESTED,
        reasons: ["review has not been requested for this execution and HEAD"],
        execution: loaded.execution,
        task: loaded.task,
        actions: ["none"],
        observedBefore: { review_handoff_present: false, task_state: loaded.task.state },
        persistedAfter: { review_handoff_present: false, task_state: loaded.task.state },
        provider_executed: false,
      });
      await this.#putEvidence(blocked);
      return blocked;
    }

    const bindingErrors = this.#bindingErrors(loaded);
    if (bindingErrors.length) {
      const blocked = this.#buildResult({
        classification: CLASSIFICATION.CORRUPT_REVIEW_BINDING,
        reasons: bindingErrors,
        execution: loaded.execution,
        task: loaded.task,
        handoff,
        actions: ["none"],
        observedBefore: { task_state: loaded.task.state, review_handoff_present: true },
        persistedAfter: { task_state: loaded.task.state, review_handoff_present: true },
        provider_executed: false,
      });
      await this.#putEvidence(blocked);
      return blocked;
    }

    if (handoff.implementation_head_sha !== intendedHead) {
      const blocked = this.#buildResult({
        classification: CLASSIFICATION.REVIEW_RESULT_STALE_HEAD,
        reasons: ["review_handoff implementation_head_sha does not match current intended HEAD"],
        execution: loaded.execution,
        task: loaded.task,
        handoff,
        actions: ["none"],
        observedBefore: await this.#observe(input.execution_id, reviewId),
        persistedAfter: await this.#observe(input.execution_id, reviewId),
        provider_executed: false,
      });
      await this.#putEvidence(blocked);
      return blocked;
    }

    const rawResult = input.result;
    const validated = this.#validateIngest(handoff, rawResult, loaded);
    if (validated.classification !== CLASSIFICATION.REVIEW_RESULT_ACCEPTED) {
      const blocked = this.#buildResult({
        classification: validated.classification,
        reasons: validated.reasons,
        execution: loaded.execution,
        task: loaded.task,
        handoff,
        result: rawResult && typeof rawResult === "object" ? rawResult : null,
        actions: ["none"],
        observedBefore: await this.#observe(input.execution_id, reviewId),
        persistedAfter: await this.#observe(input.execution_id, reviewId),
        provider_executed: input.provider_executed === true,
      });
      await this.#putEvidence(blocked);
      return blocked;
    }

    const canonical = this.#canonicalResult(handoff, rawResult);
    if (canonical.verdict === "BLOCKED") {
      const existing = await this.store.getReviewResult(reviewId);
      const actions = [];
      if (existing && sameJson(existing, canonical)) {
        actions.push("review_result_present");
      } else {
        await this.store.putReviewResult(reviewId, canonical);
        actions.push("persist_review_result");
      }
      const blocked = this.#buildResult({
        classification: CLASSIFICATION.REVIEW_BLOCKED,
        reasons: ["reviewer verdict BLOCKED is fail-closed and is not PASS"],
        execution: loaded.execution,
        task: loaded.task,
        handoff,
        result: canonical,
        actions,
        observedBefore: { task_state: loaded.task.state },
        persistedAfter: { task_state: loaded.task.state, review_result_present: true },
        provider_executed: input.provider_executed === true,
      });
      await this.#putEvidence(blocked);
      return blocked;
    }

    const existing = await this.store.getReviewResult(reviewId);
    const actions = [];
    if (existing && existing.reviewed_head_sha === canonical.reviewed_head_sha && existing.verdict === canonical.verdict && existing.reviewer_identity === canonical.reviewer_identity && existing.contract_hash === canonical.contract_hash) {
      actions.push("review_result_present");
    } else {
      await this.store.putReviewResult(reviewId, canonical);
      actions.push("persist_review_result");
    }

    let nextTask = loaded.task;
    try {
      nextTask = await this.#maybeTransitionTask(
        { ...loaded, task: await this.store.getTask(loaded.task.task_id) },
        canonical.verdict,
        actions,
        input.execution_id,
      );
    } catch (err) {
      fail([
        `reviewer automation persistence failed: ${err instanceof Error ? err.message : "unknown persist error"}`,
      ]);
    }

    if (nextTask.state === "COMPLETED") {
      fail(["reviewer automation persisted Task COMPLETED which is forbidden"]);
    }

    const out = this.#buildResult({
      classification: CLASSIFICATION.REVIEW_RESULT_ACCEPTED,
      reasons: validated.reasons.concat([`validated_verdict=${canonical.verdict}`]),
      execution: loaded.execution,
      task: nextTask,
      handoff,
      result: canonical,
      actions,
      observedBefore: { task_state: loaded.task.state, review_result_present: Boolean(existing) },
      persistedAfter: {
        task_state: nextTask.state,
        review_result_present: true,
        implementation_head_sha: handoff.implementation_head_sha,
      },
      provider_executed: input.provider_executed === true,
    });
    await this.#putEvidence(out);
    return out;
  }

  async dispatchReview(input = {}) {
    this.#requireReviewStore();
    if (!this.reviewerAdapter) {
      const blocked = this.#buildResult({
        classification: CLASSIFICATION.REVIEW_PROVIDER_FAILED,
        reasons: ["reviewer adapter is not configured"],
        actions: ["none"],
        observedBefore: {},
        persistedAfter: {},
        provider_executed: false,
      });
      return blocked;
    }
    if (this.reviewerAdapter instanceof ReviewerAdapter === false && typeof this.reviewerAdapter.review !== "function") {
      fail(["reviewerAdapter.review is required"]);
    }

    const requested = await this.requestReview(input);
    if (requested.classification !== CLASSIFICATION.REVIEW_REQUESTED) {
      return requested;
    }

    const handoff = requested.review_handoff;
    let adapterResult;
    try {
      adapterResult = await this.reviewerAdapter.review({
        schema_version: SCHEMA_VERSION,
        review_id: handoff.review_id,
        mission_id: handoff.mission_id,
        task_id: handoff.task_id,
        execution_id: handoff.execution_id,
        contract_id: handoff.contract_id,
        contract_hash: handoff.contract_hash,
        implementation_head_sha: handoff.implementation_head_sha,
        requested_reviewer_identity: handoff.requested_reviewer_identity,
        reviewer_class: handoff.reviewer_class,
        review_scope: handoff.review_scope,
        required_checks: handoff.required_checks,
        authority_claim: "none",
      });
    } catch (err) {
      const failed = this.#buildResult({
        classification: CLASSIFICATION.REVIEW_PROVIDER_FAILED,
        reasons: [
          `reviewer provider failed: ${err instanceof Error ? err.message : "unknown provider error"}`,
        ],
        execution: { execution_id: handoff.execution_id },
        task: { task_id: handoff.task_id, mission_id: handoff.mission_id, contract_id: handoff.contract_id, contract_hash: handoff.contract_hash },
        handoff,
        actions: ["provider_review_threw"],
        observedBefore: { review_handoff_present: true },
        persistedAfter: { review_handoff_present: true, review_result_present: false },
        provider_executed: false,
      });
      await this.#putEvidence(failed);
      return failed;
    }

    return this.ingestReviewResult({
      execution_id: input.execution_id,
      implementation_head_sha: handoff.implementation_head_sha,
      result: adapterResult,
      provider_executed: true,
    });
  }
}

module.exports = {
  ReviewerAutomation,
  CLASSIFICATION,
  SCHEMA_VERSION,
  reviewIdFor,
};
