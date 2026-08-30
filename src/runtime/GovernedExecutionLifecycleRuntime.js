"use strict";

/**
 * Governed execution lifecycle v1.4A.
 *
 * Canonical machines only:
 *   execution LEASED → RUNNING → RESULT_SUBMITTED | FAILED
 *   task AUTHORIZED → IN_PROGRESS → REVIEW_READY | FAILED
 *
 * Execution has no REVIEW_READY state. Task REVIEW_READY means a reviewable
 * result, not completion, GitHub approval, or merge.
 *
 * Does not call Cursor Agent. Not completion approval.
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
const { buildContractProvenance } = require("./GovernedRunEvidence");

function fail(errors) {
  throw new RuntimeValidationError(errors);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isoNow(clock) {
  return clock().toISOString().replace(/\.\d{3}Z$/, "Z");
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

class GovernedExecutionLifecycleRuntime {
  /**
   * @param {{ store: object, clock?: () => Date }} options
   */
  constructor(options = {}) {
    this.store = assertStore(options.store);
    this.clock = typeof options.clock === "function" ? options.clock : () => new Date();
  }

  async markExecutionRunning(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      fail(["markExecutionRunning input must be an object"]);
    }
    if (typeof input.execution_id !== "string") {
      fail(["markExecutionRunning requires execution_id"]);
    }
    assertCanonicalId("EXEC", input.execution_id);

    const startAuth = input.startAuthorization;
    if (!startAuth || startAuth.allowed !== true) {
      fail(["start authorization is not allowed"]);
    }

    const execution = await this.store.getExecution(input.execution_id);
    if (!execution) {
      fail([`execution not found: ${input.execution_id}`]);
    }
    if (execution.execution_id !== input.execution_id) {
      fail(["executionId does not match"]);
    }
    if (execution.state !== "LEASED") {
      fail([`execution state ${execution.state} cannot start RUNNING`]);
    }

    const task = await this.store.getTask(execution.task_id);
    if (!task) {
      fail(["task not found"]);
    }
    if (task.state !== "AUTHORIZED") {
      fail([`task state ${task.state} is not AUTHORIZED`]);
    }
    const binding = verifyContractBinding(task);
    if (!binding.valid) {
      fail(binding.errors);
    }

    const ack = await this.store.getPreExecutionAck(execution.execution_id);
    if (!ack) {
      fail(["pre-execution ack missing"]);
    }
    if (ack.execution_id !== execution.execution_id) {
      fail(["ack execution_id does not match"]);
    }
    if (ack.contract_hash !== task.contract_hash) {
      fail(["ack contract_hash does not match authorized task binding"]);
    }

    const mission = await this.store.getMission(task.mission_id);
    const assignment = await this.store.getAssignment(task.task_id);
    const correlation = validateCorrelation({ mission, task, assignment, execution });
    if (!correlation.valid) {
      fail(correlation.errors);
    }

    const dispatchPackage = await this.store.getPackage(execution.execution_id);
    const authorizedContractHash = task.contract_hash;
    const provenance = buildContractProvenance({
      task,
      ack,
      dispatchPackage,
    });
    if (provenance.authorized_contract_hash !== authorizedContractHash) {
      fail(["authorized contract hash snapshot mismatch"]);
    }

    const now = isoNow(this.clock);
    const nextExecution = clone(execution);
    nextExecution.state = "RUNNING";
    nextExecution.heartbeat_at = now;
    nextExecution.authority_claim = "none";

    const execDoc = validateDocument("execution", nextExecution);
    if (!execDoc.valid) {
      fail(execDoc.errors);
    }

    const execTransition = executionTransition(
      task,
      "LEASED",
      "RUNNING",
      "Governed start. RUNNING is not completion, GitHub approval, or merge.",
    );
    const taskMove = taskTransition(
      task,
      "AUTHORIZED",
      "IN_PROGRESS",
      "Governed start. IN_PROGRESS is not completion approval.",
    );
    const taskDoc = validateDocument("task_contract", taskMove.nextTask);
    if (!taskDoc.valid) {
      fail(taskDoc.errors);
    }
    const t1 = validateDocument("lifecycle_transition", execTransition);
    const t2 = validateDocument("lifecycle_transition", taskMove.transition);
    if (!t1.valid) {
      fail(t1.errors);
    }
    if (!t2.valid) {
      fail(t2.errors);
    }

    const postCorrelation = validateCorrelation({
      mission,
      task: taskMove.nextTask,
      assignment,
      execution: nextExecution,
    });
    if (!postCorrelation.valid) {
      fail(postCorrelation.errors);
    }

    await this.store.putExecution(nextExecution);
    await this.store.putTask(taskMove.nextTask);
    await this.store.putTransition(execTransition, execution.execution_id, "LEASED-RUNNING");
    await this.store.putTransition(taskMove.transition, execution.execution_id, "AUTHORIZED-IN_PROGRESS");

    return {
      execution: clone(nextExecution),
      task: clone(taskMove.nextTask),
      provenance,
      started_at: now,
      authorization_reference: {
        execution_id: ack.execution_id,
        acknowledged_by: clone(ack.acknowledged_by),
        acknowledged_at: ack.acknowledged_at,
        scope: ack.scope,
      },
      taskCompletionAuthorized: false,
    };
  }

  async markExecutionReviewReady(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      fail(["markExecutionReviewReady input must be an object"]);
    }
    if (typeof input.execution_id !== "string") {
      fail(["markExecutionReviewReady requires execution_id"]);
    }
    assertCanonicalId("EXEC", input.execution_id);
    if (!input.validation || input.validation.passed !== true) {
      fail(["independent validation has not passed"]);
    }

    const execution = await this.store.getExecution(input.execution_id);
    if (!execution) {
      fail([`execution not found: ${input.execution_id}`]);
    }
    if (execution.state !== "RUNNING") {
      fail([`execution state ${execution.state} cannot become review-ready`]);
    }

    const task = await this.store.getTask(execution.task_id);
    if (!task) {
      fail(["task not found"]);
    }
    if (task.state !== "IN_PROGRESS") {
      fail([`task state ${task.state} cannot become REVIEW_READY`]);
    }

    const now = isoNow(this.clock);
    const nextExecution = clone(execution);
    nextExecution.state = "RESULT_SUBMITTED";
    nextExecution.outcome = "SUCCESS";
    nextExecution.heartbeat_at = now;
    delete nextExecution.lease_token;
    delete nextExecution.leased_at;
    delete nextExecution.lease_ttl_seconds;
    nextExecution.authority_claim = "none";

    const execDoc = validateDocument("execution", nextExecution);
    if (!execDoc.valid) {
      fail(execDoc.errors);
    }

    const execTransition = executionTransition(
      task,
      "RUNNING",
      "RESULT_SUBMITTED",
      "Independent validation PASS. RESULT_SUBMITTED is a reviewable execution result, not Task completion.",
    );
    const taskMove = taskTransition(
      task,
      "IN_PROGRESS",
      "REVIEW_READY",
      "Independent validation PASS. REVIEW_READY is not completion, GitHub approval, or merge.",
    );
    const taskDoc = validateDocument("task_contract", taskMove.nextTask);
    if (!taskDoc.valid) {
      fail(taskDoc.errors);
    }

    await this.store.putExecution(nextExecution);
    await this.store.putTask(taskMove.nextTask);
    await this.store.putTransition(execTransition, execution.execution_id, "RUNNING-RESULT_SUBMITTED");
    await this.store.putTransition(taskMove.transition, execution.execution_id, "IN_PROGRESS-REVIEW_READY");

    return {
      execution: clone(nextExecution),
      task: clone(taskMove.nextTask),
      taskCompletionAuthorized: false,
    };
  }

  async markExecutionFailed(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      fail(["markExecutionFailed input must be an object"]);
    }
    if (typeof input.execution_id !== "string") {
      fail(["markExecutionFailed requires execution_id"]);
    }
    assertCanonicalId("EXEC", input.execution_id);

    const execution = await this.store.getExecution(input.execution_id);
    if (!execution) {
      fail([`execution not found: ${input.execution_id}`]);
    }
    if (execution.state !== "RUNNING") {
      fail([`execution state ${execution.state} cannot fail-closed from this runtime`]);
    }
    const task = await this.store.getTask(execution.task_id);
    if (!task) {
      fail(["task not found"]);
    }
    if (task.state !== "IN_PROGRESS") {
      fail([`task state ${task.state} cannot fail-closed from RUNNING`]);
    }

    const now = isoNow(this.clock);
    const nextExecution = clone(execution);
    nextExecution.state = "FAILED";
    nextExecution.outcome = "FAILED";
    nextExecution.heartbeat_at = now;
    delete nextExecution.lease_token;
    delete nextExecution.leased_at;
    delete nextExecution.lease_ttl_seconds;
    nextExecution.authority_claim = "none";

    const execDoc = validateDocument("execution", nextExecution);
    if (!execDoc.valid) {
      fail(execDoc.errors);
    }

    const execTransition = executionTransition(
      task,
      "RUNNING",
      "FAILED",
      "Independent validation FAIL. FAILED is not REVIEW_READY and not completion.",
    );
    const taskMove = taskTransition(
      task,
      "IN_PROGRESS",
      "FAILED",
      "Independent validation FAIL. Task is not completed.",
    );

    await this.store.putExecution(nextExecution);
    await this.store.putTask(taskMove.nextTask);
    await this.store.putTransition(execTransition, execution.execution_id, "RUNNING-FAILED");
    await this.store.putTransition(taskMove.transition, execution.execution_id, "IN_PROGRESS-FAILED");

    return {
      execution: clone(nextExecution),
      task: clone(taskMove.nextTask),
      taskCompletionAuthorized: false,
    };
  }
}

module.exports = {
  GovernedExecutionLifecycleRuntime,
};
