"use strict";

/**
 * Orchestrates one governed Cursor execution:
 * Gate allowed===true → persist RUNNING → injected runner → validate →
 * persist RESULT_SUBMITTED/REVIEW_READY or FAILED → Evidence DATA of
 * the actually persisted states.
 *
 * Does not grant Task completion. EVIDENCE_AUTHORITY=NO.
 * Real Cursor Agent is not invoked unless a real runner is injected.
 * MULTI_FILE_ATOMICITY=NO. PARTIAL_PERSIST_RECOVERY=NOT_IMPLEMENTED.
 * FAIL_CLOSED=YES.
 */

const { assertStore } = require("./MissionTaskStore");
const { assertCanonicalId } = require("./ids");
const { RuntimeValidationError } = require("./MissionTaskRuntime");
const { GovernedExecutionLifecycleRuntime } = require("./GovernedExecutionLifecycleRuntime");
const { validateRunnerResult } = require("./RunnerResultValidator");
const {
  buildGovernedRunEvidence,
  nextEvidenceId,
} = require("./GovernedRunEvidence");

function fail(errors) {
  throw new RuntimeValidationError(errors);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class MemoryEvidenceSink {
  constructor() {
    this.records = [];
  }

  async putEvidence(doc) {
    this.records.push(clone(doc));
    return doc;
  }

  async listEvidenceIds() {
    return this.records.map((item) => item.evidence_id).filter(Boolean);
  }

  async listEvidence() {
    return this.records.map((item) => clone(item));
  }
}

class GovernedExecutionRuntime {
  /**
   * @param {{
   *   store: object,
   *   evaluateStartAuthorization: Function,
   *   runner: { run: Function },
   *   evidenceSink?: { putEvidence: Function, listEvidenceIds?: Function },
   *   clock?: () => Date,
   * }} options
   */
  constructor(options = {}) {
    this.store = assertStore(options.store);
    if (typeof options.evaluateStartAuthorization !== "function") {
      throw new Error("GovernedExecutionRuntime requires evaluateStartAuthorization");
    }
    if (!options.runner || typeof options.runner.run !== "function") {
      throw new Error("GovernedExecutionRuntime requires runner.run");
    }
    this.evaluateStartAuthorization = options.evaluateStartAuthorization;
    this.runner = options.runner;
    this.evidenceSink =
      options.evidenceSink && typeof options.evidenceSink.putEvidence === "function"
        ? options.evidenceSink
        : new MemoryEvidenceSink();
    this.clock = typeof options.clock === "function" ? options.clock : () => new Date();
    this.lifecycle = new GovernedExecutionLifecycleRuntime({
      store: this.store,
      clock: this.clock,
      evaluateStartAuthorization: this.evaluateStartAuthorization,
    });
  }

  async runGovernedExecution(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      fail(["runGovernedExecution input must be an object"]);
    }
    if (typeof input.execution_id !== "string") {
      fail(["runGovernedExecution requires execution_id"]);
    }
    assertCanonicalId("EXEC", input.execution_id);
    if (!input.runnerRequest || typeof input.runnerRequest !== "object") {
      fail(["runnerRequest is required"]);
    }

    const execution = await this.store.getExecution(input.execution_id);
    if (!execution) {
      fail([`execution not found: ${input.execution_id}`]);
    }
    if (execution.state !== "LEASED") {
      fail([`single-execution envelope already started: ${execution.state}`]);
    }

    const task = await this.store.getTask(execution.task_id);
    if (!task) {
      fail(["task not found"]);
    }
    if (input.runnerRequest.executionId !== execution.execution_id) {
      fail(["runnerRequest.executionId does not match execution_id"]);
    }
    if (input.runnerRequest.taskId !== task.task_id) {
      fail(["runnerRequest.taskId does not match task_id"]);
    }
    if (input.runnerRequest.contractId !== task.contract_id) {
      fail(["runnerRequest.contractId does not match contract_id"]);
    }

    const running = await this.lifecycle.markExecutionRunning({
      execution_id: input.execution_id,
    });

    if (typeof this.store.putRunnerAttempt !== "function") {
      fail(["runner attempt identity is required before governed runner invocation"]);
    }

    const attempt = {
      schema_version: "1.5-governed-runner-attempt",
      document_kind: "runner_attempt",
      attempt_id: `ATTEMPT-${input.execution_id}`,
      execution_id: input.execution_id,
      task_id: running.task.task_id,
      contract_id: running.task.contract_id,
      contract_hash: running.task.contract_hash,
      invocation_state: "INVOKED",
      runner_result: null,
      authority_claim: "none",
    };
    await this.store.putRunnerAttempt(input.execution_id, attempt);

    let runnerResult;
    try {
      runnerResult = await this.runner.run(input.runnerRequest);
    } catch (err) {
      await this.lifecycle.markExecutionFailed({ execution_id: input.execution_id });
      fail([err instanceof Error ? err.message : "runner invocation failed"]);
    }

    const returnedAttempt = clone(attempt);
    returnedAttempt.invocation_state = "RETURNED";
    returnedAttempt.runner_result = clone(runnerResult);
    await this.store.putRunnerAttempt(input.execution_id, returnedAttempt);

    const expectations = input.validationExpectations || {};
    const validation = validateRunnerResult(runnerResult, expectations);

    let persisted;
    if (validation.passed === true) {
      persisted = await this.lifecycle.markExecutionReviewReady({
        execution_id: input.execution_id,
        runnerResult,
        validationExpectations: expectations,
      });
    } else {
      persisted = await this.lifecycle.markExecutionFailed({
        execution_id: input.execution_id,
      });
    }

    const ack = await this.store.getPreExecutionAck(input.execution_id);
    const dispatchPackage = await this.store.getPackage(input.execution_id);
    const persistedExecution = await this.store.getExecution(input.execution_id);
    const persistedTask = await this.store.getTask(persisted.task.task_id);
    const existingIds =
      this.evidenceSink && typeof this.evidenceSink.listEvidenceIds === "function"
        ? await this.evidenceSink.listEvidenceIds()
        : [];
    const evidenceId = nextEvidenceId(this.clock, existingIds);
    const evidence = buildGovernedRunEvidence({
      evidenceId,
      task: persistedTask,
      execution: persistedExecution,
      ack,
      dispatchPackage,
      provenance: running.provenance,
      runnerResult,
      validation,
      expectations,
      canonicalMainSha: running.execution.base_sha,
      transitionPersisted: true,
    });
    try {
      await this.evidenceSink.putEvidence(evidence);
    } catch (err) {
      fail([
        `evidence persistence failed after lifecycle persist: ${
          err instanceof Error ? err.message : "unknown evidence sink error"
        }`,
        `execution_state=${persistedExecution.state}`,
        `task_state=${persistedTask.state}`,
      ]);
    }

    return {
      execution: clone(persistedExecution),
      task: clone(persistedTask),
      runnerResult,
      validation,
      evidence,
      provenance: running.provenance,
      taskCompletionAuthorized: false,
      runnerInvoked: true,
    };
  }
}

module.exports = {
  GovernedExecutionRuntime,
  MemoryEvidenceSink,
};
