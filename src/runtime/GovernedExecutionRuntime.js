"use strict";

/**
 * Orchestrates one governed Cursor execution:
 * Gate allowed===true → persist RUNNING → injected runner → validate →
 * evidence DATA → REVIEW_READY (task) / RESULT_SUBMITTED (execution).
 *
 * Does not grant Task completion. EVIDENCE_AUTHORITY=NO.
 * Real Cursor Agent is not invoked unless a real runner is injected.
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
    if (input.runnerRequest.executionId !== input.execution_id) {
      fail(["runnerRequest.executionId does not match execution_id"]);
    }

    const execution = await this.store.getExecution(input.execution_id);
    if (!execution) {
      fail([`execution not found: ${input.execution_id}`]);
    }
    if (execution.state !== "LEASED") {
      fail([`single-execution envelope already started: ${execution.state}`]);
    }

    let startAuth;
    try {
      startAuth = await this.evaluateStartAuthorization(input.execution_id);
    } catch (err) {
      fail([err instanceof Error ? err.message : "start authorization evaluation failed"]);
    }
    if (!startAuth || startAuth.allowed !== true) {
      fail(
        startAuth && Array.isArray(startAuth.reasons) && startAuth.reasons.length
          ? startAuth.reasons
          : ["pre-execution start authorization is not allowed"],
      );
    }

    const running = await this.lifecycle.markExecutionRunning({
      execution_id: input.execution_id,
      startAuthorization: startAuth,
    });

    let runnerResult;
    try {
      runnerResult = await this.runner.run(input.runnerRequest);
    } catch (err) {
      await this.lifecycle.markExecutionFailed({ execution_id: input.execution_id });
      fail([err instanceof Error ? err.message : "runner invocation failed"]);
    }

    const expectations = input.validationExpectations || {};
    const validation = validateRunnerResult(runnerResult, expectations);

    const ack = await this.store.getPreExecutionAck(input.execution_id);
    const dispatchPackage = await this.store.getPackage(input.execution_id);
    const existingIds =
      this.evidenceSink && typeof this.evidenceSink.listEvidenceIds === "function"
        ? await this.evidenceSink.listEvidenceIds()
        : [];
    const evidenceId = nextEvidenceId(this.clock, existingIds);
    const evidence = buildGovernedRunEvidence({
      evidenceId,
      task: running.task,
      execution: running.execution,
      ack,
      dispatchPackage,
      provenance: running.provenance,
      runnerResult,
      validation,
      expectations,
      canonicalMainSha: running.execution.base_sha,
    });
    await this.evidenceSink.putEvidence(evidence);

    if (validation.passed === true) {
      const reviewable = await this.lifecycle.markExecutionReviewReady({
        execution_id: input.execution_id,
        validation,
      });
      return {
        execution: reviewable.execution,
        task: reviewable.task,
        runnerResult,
        validation,
        evidence,
        provenance: running.provenance,
        taskCompletionAuthorized: false,
        runnerInvoked: true,
      };
    }

    const failed = await this.lifecycle.markExecutionFailed({
      execution_id: input.execution_id,
    });
    return {
      execution: failed.execution,
      task: failed.task,
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
