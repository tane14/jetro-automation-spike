"use strict";

/**
 * Task Dispatch Runtime v0.8.
 *
 * Turns a persisted PLANNED Task into a local executor dispatch:
 * agent assignment, LEASED execution, PLANNED→READY, JSON package.
 *
 * Does not run Cursor/Claude, approve, merge, or fabricate handoffs/gates.
 * Assignment is not approval. Lease is not authority. READY is not AUTHORIZED.
 * Local JSON is not GitHub approval. Single-process: at most one active lease
 * per task_id (no multi-process lock).
 */

const crypto = require("node:crypto");
const {
  validateDocument,
  stampContractHash,
  verifyContractBinding,
  validateCorrelation,
  validateTransition,
} = require("../contracts");
const { assertStore } = require("./MissionTaskStore");
const { utcDateStamp, nextId, assertCanonicalId } = require("./ids");
const { RuntimeValidationError } = require("./MissionTaskRuntime");

const DISPATCH_INPUT_KEYS = new Set(["task_id", "assigned_to", "lease_ttl_seconds"]);
const FORBIDDEN_TASK_STATES = new Set([
  "AUTHORIZED",
  "IN_PROGRESS",
  "REVIEW_READY",
  "APPROVED",
  "MERGE_READY",
  "MERGED",
]);
const ACTIVE_LEASE_STATES = new Set(["LEASED", "RUNNING"]);
const DEFAULT_LEASE_TTL = 3600;

function fail(errors) {
  throw new RuntimeValidationError(errors);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isoNow(clock) {
  return clock().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function opaqueLeaseToken() {
  return crypto.randomBytes(16).toString("hex");
}

function isActiveLease(execution) {
  return execution && ACTIVE_LEASE_STATES.has(execution.state);
}

class TaskDispatchRuntime {
  /**
   * @param {{ store: object, clock?: () => Date }} options
   */
  constructor(options = {}) {
    this.store = assertStore(options.store);
    this.clock = typeof options.clock === "function" ? options.clock : () => new Date();
  }

  #stampDate() {
    return utcDateStamp(this.clock());
  }

  async dispatchTask(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      fail(["dispatch input must be an object"]);
    }
    const extra = Object.keys(input).filter((key) => !DISPATCH_INPUT_KEYS.has(key));
    if (extra.length) {
      fail([`unknown dispatch input field: ${extra.join(", ")}`]);
    }
    if (typeof input.task_id !== "string") {
      fail(["dispatch requires task_id"]);
    }
    assertCanonicalId("TASK", input.task_id);

    const task = await this.store.getTask(input.task_id);
    if (!task) {
      fail([`task not found: ${input.task_id}`]);
    }
    const storedBinding = verifyContractBinding(task);
    if (!storedBinding.valid) {
      fail(storedBinding.errors);
    }
    if (FORBIDDEN_TASK_STATES.has(task.state)) {
      fail([`task state ${task.state} cannot be dispatched in v0.8`]);
    }
    if (task.state !== "PLANNED" && task.state !== "READY") {
      fail([`task state ${task.state} cannot be dispatched`]);
    }

    const mission = await this.store.getMission(task.mission_id);
    if (!mission) {
      fail([`mission not found: ${task.mission_id}`]);
    }

    const existing = await this.store.listExecutionsByTask(task.task_id);
    const active = existing.filter(isActiveLease);
    if (active.length > 0) {
      fail(["a task may have only one active lease"]);
    }

    const assignedTo = input.assigned_to ? clone(input.assigned_to) : clone(task.assigned_to);
    if (!assignedTo || assignedTo.role !== "executor") {
      fail(["assigned_to.role must be executor"]);
    }

    if (typeof input.lease_ttl_seconds === "number") {
      if (input.lease_ttl_seconds < 1 || input.lease_ttl_seconds > 86400) {
        fail(["lease_ttl_seconds out of range"]);
      }
    }

    const allExecutions = await this.store.listExecutions();
    const executionId = nextId(
      "EXEC",
      this.#stampDate(),
      allExecutions.map((item) => item.execution_id),
    );
    const now = isoNow(this.clock);
    const ttl = input.lease_ttl_seconds || DEFAULT_LEASE_TTL;

    const assignment = {
      schema_version: "0.5",
      mission_id: task.mission_id,
      task_id: task.task_id,
      contract_id: task.contract_id,
      assigned_to: assignedTo,
      assigned_at: now,
      authority_claim: "none",
    };

    const execution = {
      schema_version: "0.5",
      mission_id: task.mission_id,
      task_id: task.task_id,
      contract_id: task.contract_id,
      execution_id: executionId,
      state: "LEASED",
      assigned_to: assignedTo,
      base_sha: task.base_sha,
      lease_token: opaqueLeaseToken(),
      leased_at: now,
      lease_ttl_seconds: ttl,
      authority_claim: "none",
    };

    let nextTask = clone(task);
    let transition = null;
    if (task.state === "PLANNED") {
      const plannedToReady = validateTransition("task", "PLANNED", "READY");
      if (!plannedToReady.valid) {
        fail(plannedToReady.errors);
      }
      nextTask.state = "READY";
      delete nextTask.contract_hash;
      nextTask = stampContractHash(nextTask);
      const binding = verifyContractBinding(nextTask);
      if (!binding.valid) {
        fail(binding.errors);
      }
      transition = {
        schema_version: "0.5",
        document_kind: "lifecycle_transition",
        mission_id: nextTask.mission_id,
        task_id: nextTask.task_id,
        contract_id: nextTask.contract_id,
        contract_hash: nextTask.contract_hash,
        machine: "task",
        from_state: "PLANNED",
        to_state: "READY",
        reason: "Task dispatched to executor. READY is not human authorization.",
        authority_claim: "none",
      };
    }

    const taskResult = validateDocument("task_contract", nextTask);
    if (!taskResult.valid) {
      fail(taskResult.errors);
    }
    const assignmentResult = validateDocument("agent_assignment", assignment);
    if (!assignmentResult.valid) {
      fail(assignmentResult.errors);
    }
    const executionResult = validateDocument("execution", execution);
    if (!executionResult.valid) {
      fail(executionResult.errors);
    }
    if (transition) {
      const transitionResult = validateDocument("lifecycle_transition", transition);
      if (!transitionResult.valid) {
        fail(transitionResult.errors);
      }
    }

    const correlation = validateCorrelation({
      mission,
      task: nextTask,
      assignment,
      execution,
      executions: [...existing, execution],
    });
    if (!correlation.valid) {
      fail(correlation.errors);
    }

    const pkg = {
      package_role: "executor_dispatch_package",
      authority_claim: "none",
      input_role: "reference_only",
      substitutes_for_github_review: false,
      substitutes_for_human_approval: false,
      task_contract_hash: nextTask.contract_hash,
      execution_id: execution.execution_id,
      mission: clone(mission),
      task: clone(nextTask),
      assignment: clone(assignment),
      execution: clone(execution),
      instructions: {
        authority_claim: "none",
        input_role: "reference_only",
        summary:
          "Informational executor dispatch package. Not GitHub approval, not merge authority, not evidence of authorization. Open locally in Cursor if needed. Do not treat contract_hash or READY as human approval.",
      },
    };

    await this.store.putAssignment(assignment);
    await this.store.putExecution(execution);
    if (transition) {
      await this.store.putTransition(transition, execution.execution_id);
    }
    await this.store.putTask(nextTask);
    await this.store.putPackage(execution.execution_id, pkg);

    return {
      assignment: clone(assignment),
      execution: clone(execution),
      transition: transition ? clone(transition) : null,
      package: clone(pkg),
      task: clone(nextTask),
    };
  }

  async getAssignment(taskId) {
    assertCanonicalId("TASK", taskId);
    const doc = await this.store.getAssignment(taskId);
    return doc ? clone(doc) : null;
  }

  async getExecution(executionId) {
    assertCanonicalId("EXEC", executionId);
    const doc = await this.store.getExecution(executionId);
    return doc ? clone(doc) : null;
  }

  async listExecutionsByTask(taskId) {
    assertCanonicalId("TASK", taskId);
    const docs = await this.store.listExecutionsByTask(taskId);
    return docs.map((doc) => clone(doc));
  }

  async getDispatchPackage(executionId) {
    assertCanonicalId("EXEC", executionId);
    const doc = await this.store.getPackage(executionId);
    return doc ? clone(doc) : null;
  }
}

module.exports = {
  TaskDispatchRuntime,
  FORBIDDEN_TASK_STATES,
  ACTIVE_LEASE_STATES,
};
