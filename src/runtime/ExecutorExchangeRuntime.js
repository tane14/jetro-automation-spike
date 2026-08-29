"use strict";

/**
 * Executor Exchange Runtime v0.9.
 *
 * Local JSON inbox/outbox between TaskDispatchRuntime packages and an
 * external executor. Human-triggered only. Does not call Cursor, Claude,
 * or GitHub. Does not grant authority.
 *
 * execution_handoff is an operational executor result, not review and not
 * GitHub approval. RESULT_SUBMITTED is not approved. Task stays READY.
 */

const crypto = require("node:crypto");
const {
  validateDocument,
  verifyContractBinding,
  verifyCopiedBinding,
  validateCorrelation,
  validateTransition,
} = require("../contracts");
const { assertStore } = require("./MissionTaskStore");
const { assertCanonicalId } = require("./ids");
const { RuntimeValidationError } = require("./MissionTaskRuntime");

const EXPORT_INPUT_KEYS = new Set(["execution_id"]);
const INGEST_INPUT_KEYS = new Set(["execution_id", "lease_token", "handoff"]);
const ACTIVE_LEASE_STATES = new Set(["LEASED", "RUNNING"]);
const FORBIDDEN_HANDOFF_KINDS = new Set([
  "review_handoff",
  "human_approval_gate",
  "human_approval",
  "task_contract",
  "agent_assignment",
  "lifecycle_transition",
]);
const FORBIDDEN_HANDOFF_KEYS = new Set([
  "lease_token",
  "verdict",
  "verdict_kind",
  "review_id",
  "reviewer",
  "github_approver",
  "reviewed_head_sha",
  "authority_rank",
  "live_verification_required",
  "substitutes_for_github_review",
  "approval_gate",
  "review_handoff",
]);
const EXECUTOR_HANDOFF_KEYS = new Set([
  "outcome",
  "self_reported_summary",
  "files_changed",
  "evidence_refs",
  "pr_number",
  "head_sha",
  "policy_refs",
]);
const STRUCTURAL_HANDOFF_KEYS = [
  "schema_version",
  "document_kind",
  "mission_id",
  "task_id",
  "contract_id",
  "contract_hash",
  "execution_id",
  "base_sha",
  "source_role",
  "target_role",
  "summary_role",
  "authority_claim",
];

function fail(errors) {
  throw new RuntimeValidationError(errors);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isoNow(clock) {
  return clock().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function leaseTokensMatch(stored, provided) {
  if (typeof stored !== "string" || typeof provided !== "string") {
    return false;
  }
  const left = Buffer.from(stored, "utf8");
  const right = Buffer.from(provided, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
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

class ExecutorExchangeRuntime {
  /**
   * @param {{ store: object, clock?: () => Date }} options
   */
  constructor(options = {}) {
    this.store = assertStore(options.store);
    this.clock = typeof options.clock === "function" ? options.clock : () => new Date();
  }

  async exportDispatchPackage(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      fail(["export input must be an object"]);
    }
    const extra = Object.keys(input).filter((key) => !EXPORT_INPUT_KEYS.has(key));
    if (extra.length) {
      fail([`unknown export input field: ${extra.join(", ")}`]);
    }
    if (typeof input.execution_id !== "string") {
      fail(["export requires execution_id"]);
    }
    assertCanonicalId("EXEC", input.execution_id);

    const pkg = await this.store.getPackage(input.execution_id);
    if (!pkg) {
      fail([`package not found: ${input.execution_id}`]);
    }
    const execution = await this.store.getExecution(input.execution_id);
    if (!execution) {
      fail([`execution not found: ${input.execution_id}`]);
    }
    const task = await this.store.getTask(execution.task_id);
    if (!task) {
      fail([`task not found: ${execution.task_id}`]);
    }
    const storedBinding = verifyContractBinding(task);
    if (!storedBinding.valid) {
      fail(storedBinding.errors);
    }
    const mission = await this.store.getMission(task.mission_id);
    if (!mission) {
      fail([`mission not found: ${task.mission_id}`]);
    }
    const assignment = await this.store.getAssignment(task.task_id);

    if (pkg.execution_id !== execution.execution_id) {
      fail(["package/result mismatch: execution_id"]);
    }
    if (pkg.task && pkg.task.task_id !== task.task_id) {
      fail(["package/result mismatch: task_id"]);
    }
    if (pkg.task && pkg.task.contract_hash !== task.contract_hash) {
      fail(["package/result mismatch: contract_hash"]);
    }
    if (pkg.authority_claim && pkg.authority_claim !== "none") {
      fail(["package cannot claim authority"]);
    }

    const correlation = validateCorrelation({
      mission,
      task,
      assignment,
      execution,
    });
    if (!correlation.valid) {
      fail(correlation.errors);
    }

    const filePath = await this.store.putOutbox(execution.execution_id, clone(pkg));
    return {
      path: filePath,
      package: clone(pkg),
    };
  }

  async ingestHandoff(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      fail(["ingest input must be an object"]);
    }
    const extra = Object.keys(input).filter((key) => !INGEST_INPUT_KEYS.has(key));
    if (extra.length) {
      fail([`unknown ingest input field: ${extra.join(", ")}`]);
    }
    if (typeof input.execution_id !== "string") {
      fail(["ingest requires execution_id"]);
    }
    assertCanonicalId("EXEC", input.execution_id);
    if (typeof input.lease_token !== "string") {
      fail(["ingest requires lease_token"]);
    }
    if (!input.handoff || typeof input.handoff !== "object" || Array.isArray(input.handoff)) {
      fail(["ingest requires a handoff object"]);
    }

    const existingHandoff = await this.store.getHandoff(input.execution_id);
    if (existingHandoff) {
      fail(["a handoff is already persisted for this execution_id"]);
    }

    const execution = await this.store.getExecution(input.execution_id);
    if (!execution) {
      fail([`execution not found: ${input.execution_id}`]);
    }
    if (!ACTIVE_LEASE_STATES.has(execution.state)) {
      fail([`execution state ${execution.state} cannot ingest a handoff`]);
    }
    if (!leaseTokensMatch(execution.lease_token, input.lease_token)) {
      fail(["lease_token does not match"]);
    }
    if (leaseExpired(execution, this.clock())) {
      fail(["lease has expired"]);
    }

    const task = await this.store.getTask(execution.task_id);
    if (!task) {
      fail([`task not found: ${execution.task_id}`]);
    }
    if (task.state !== "READY") {
      fail([`task state ${task.state} cannot ingest a handoff in v0.9`]);
    }
    const storedBinding = verifyContractBinding(task);
    if (!storedBinding.valid) {
      fail(storedBinding.errors);
    }

    const mission = await this.store.getMission(task.mission_id);
    if (!mission) {
      fail([`mission not found: ${task.mission_id}`]);
    }
    const assignment = await this.store.getAssignment(task.task_id);

    const submitted = clone(input.handoff);
    if (FORBIDDEN_HANDOFF_KINDS.has(submitted.document_kind)) {
      fail([`ingest accepts only execution_handoff, not ${submitted.document_kind}`]);
    }
    if (submitted.document_kind && submitted.document_kind !== "execution_handoff") {
      fail([`ingest accepts only execution_handoff, not ${submitted.document_kind}`]);
    }
    for (const key of FORBIDDEN_HANDOFF_KEYS) {
      if (Object.prototype.hasOwnProperty.call(submitted, key)) {
        fail([`handoff must not include ${key}`]);
      }
    }

    const structural = {
      schema_version: "0.5",
      document_kind: "execution_handoff",
      mission_id: execution.mission_id,
      task_id: execution.task_id,
      contract_id: execution.contract_id,
      contract_hash: task.contract_hash,
      execution_id: execution.execution_id,
      base_sha: execution.base_sha,
      source_role: "executor",
      target_role: "reviewer",
      summary_role: "informational_only",
      authority_claim: "none",
    };

    for (const key of STRUCTURAL_HANDOFF_KEYS) {
      if (submitted[key] !== undefined && submitted[key] !== structural[key]) {
        fail([`handoff ${key} does not match stored execution/task`]);
      }
    }

    const allowed = new Set([...STRUCTURAL_HANDOFF_KEYS, ...EXECUTOR_HANDOFF_KEYS]);
    const unknown = Object.keys(submitted).filter((key) => !allowed.has(key));
    if (unknown.length) {
      fail([`unknown handoff field: ${unknown.join(", ")}`]);
    }

    const handoff = { ...structural };
    for (const key of EXECUTOR_HANDOFF_KEYS) {
      if (submitted[key] !== undefined) {
        handoff[key] = submitted[key];
      }
    }

    const handoffResult = validateDocument("execution_handoff", handoff);
    if (!handoffResult.valid) {
      fail(handoffResult.errors);
    }
    const copied = verifyCopiedBinding(handoff, task);
    if (!copied.valid) {
      fail(copied.errors);
    }

    const now = isoNow(this.clock);
    const nextExecution = clone(execution);
    nextExecution.state = "RESULT_SUBMITTED";
    nextExecution.outcome = handoff.outcome;
    nextExecution.heartbeat_at = now;
    delete nextExecution.lease_token;
    delete nextExecution.leased_at;
    delete nextExecution.lease_ttl_seconds;
    if (handoff.pr_number !== undefined) {
      nextExecution.pr_number = handoff.pr_number;
    }
    if (handoff.head_sha !== undefined) {
      nextExecution.head_sha = handoff.head_sha;
    }

    const transitions = [];
    if (execution.state === "LEASED") {
      transitions.push(
        this.#executionTransition(task, execution.execution_id, "LEASED", "RUNNING", now),
      );
    }
    transitions.push(
      this.#executionTransition(
        task,
        execution.execution_id,
        "RUNNING",
        "RESULT_SUBMITTED",
        now,
      ),
    );

    const executionResult = validateDocument("execution", nextExecution);
    if (!executionResult.valid) {
      fail(executionResult.errors);
    }
    for (const transition of transitions) {
      const transitionResult = validateDocument("lifecycle_transition", transition);
      if (!transitionResult.valid) {
        fail(transitionResult.errors);
      }
    }

    const siblings = await this.store.listExecutionsByTask(task.task_id);
    const executions = siblings.map((item) =>
      item.execution_id === nextExecution.execution_id ? nextExecution : item,
    );

    const correlation = validateCorrelation({
      mission,
      task,
      assignment,
      execution: nextExecution,
      execution_handoff: handoff,
      executions,
    });
    if (!correlation.valid) {
      fail(correlation.errors);
    }

    if (task.state !== "READY") {
      fail(["ingest must not change Task state; Task must remain READY"]);
    }

    await this.store.putHandoff(execution.execution_id, handoff);
    await this.store.putInbox(execution.execution_id, clone(handoff));
    for (const transition of transitions) {
      const suffix = `${transition.from_state}-${transition.to_state}`;
      await this.store.putTransition(transition, execution.execution_id, suffix);
    }
    await this.store.putExecution(nextExecution);

    return {
      execution: clone(nextExecution),
      handoff: clone(handoff),
      transitions: transitions.map((item) => clone(item)),
      task: clone(task),
    };
  }

  #executionTransition(task, executionId, fromState, toState, _now) {
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
      reason:
        "Executor exchange ingest. RUNNING and RESULT_SUBMITTED are not human authorization.",
      authority_claim: "none",
    };
  }

  async getHandoff(executionId) {
    assertCanonicalId("EXEC", executionId);
    const doc = await this.store.getHandoff(executionId);
    return doc ? clone(doc) : null;
  }

  async listHandoffsByTask(taskId) {
    assertCanonicalId("TASK", taskId);
    const docs = await this.store.listHandoffsByTask(taskId);
    return docs.map((doc) => clone(doc));
  }
}

module.exports = {
  ExecutorExchangeRuntime,
};
