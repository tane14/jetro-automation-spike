"use strict";

/**
 * Pre-Execution Gate Runtime v1.0.
 *
 * Human-triggered operational acknowledgement that a specific LEASED
 * execution may later be started. READY → AUTHORIZED on the Task.
 * AUTHORIZED is not GitHub approval, not completion approval, and not merge.
 *
 * Does not start Cursor, Claude, RUNNING, or any agent runner.
 * Future runner MUST call evaluateStartAuthorization and spawn only when
 * allowed === true (ack + AUTHORIZED + LEASED + binding + lease + correlation).
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

const AUTHORIZE_INPUT_KEYS = new Set(["execution_id", "acknowledged_by"]);
const ACK_RECORD_KIND = "pre_execution_ack";
const HUMAN_IDENTITY_RE = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
const DENIED_IDENTITIES = new Set([
  "executor",
  "cursor",
  "claude",
  "gpt",
  "chatgpt",
  "openai",
  "anthropic",
  "system",
  "automation",
  "automatic_agent",
  "orchestrator",
  "agent",
  "bot",
  "copilot",
]);

const NOT_START_AUTH = {
  allowed: false,
  sufficient_for_authority: false,
  requires_live_github_approval: true,
  start_authorization: "NOT_AUTHORIZED",
  label: "Execution start authorization",
};

function fail(errors) {
  throw new RuntimeValidationError(errors);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isoNow(clock) {
  return clock().toISOString().replace(/\.\d{3}Z$/, "Z");
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

function deniedIdentity(identity) {
  return DENIED_IDENTITIES.has(String(identity).toLowerCase());
}

function parseAcknowledgedBy(raw) {
  let actor = raw;
  if (typeof raw === "string") {
    actor = { kind: "human", identity: raw };
  }
  if (!actor || typeof actor !== "object" || Array.isArray(actor)) {
    fail(["acknowledged_by must be a human identity"]);
  }
  const extra = Object.keys(actor).filter((key) => key !== "kind" && key !== "identity");
  if (extra.length) {
    fail([`unknown acknowledged_by field: ${extra.join(", ")}`]);
  }
  if (actor.kind !== "human") {
    fail(["acknowledged_by.kind must be human"]);
  }
  if (typeof actor.identity !== "string" || !HUMAN_IDENTITY_RE.test(actor.identity)) {
    fail(["acknowledged_by.identity is invalid"]);
  }
  if (deniedIdentity(actor.identity)) {
    fail(["acknowledged_by is not a human operator identity"]);
  }
  return { kind: "human", identity: actor.identity };
}

function denyStart(reasons) {
  return {
    ...NOT_START_AUTH,
    allowed: false,
    reasons: Array.isArray(reasons) ? reasons : [String(reasons)],
  };
}

class PreExecutionGateRuntime {
  /**
   * @param {{ store: object, clock?: () => Date }} options
   */
  constructor(options = {}) {
    this.store = assertStore(options.store);
    this.clock = typeof options.clock === "function" ? options.clock : () => new Date();
  }

  async authorizeExecution(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      fail(["authorize input must be an object"]);
    }
    const extra = Object.keys(input).filter((key) => !AUTHORIZE_INPUT_KEYS.has(key));
    if (extra.length) {
      fail([`unknown authorize input field: ${extra.join(", ")}`]);
    }
    if (typeof input.execution_id !== "string") {
      fail(["authorize requires execution_id"]);
    }
    assertCanonicalId("EXEC", input.execution_id);
    const acknowledgedBy = parseAcknowledgedBy(input.acknowledged_by);

    const existing = await this.store.getPreExecutionAck(input.execution_id);
    if (existing) {
      fail(["a pre-execution ack already exists for this execution_id"]);
    }

    const execution = await this.store.getExecution(input.execution_id);
    if (!execution) {
      fail([`execution not found: ${input.execution_id}`]);
    }
    if (execution.state !== "LEASED") {
      fail([`execution state ${execution.state} cannot be authorized to start`]);
    }
    if (leaseExpired(execution, this.clock())) {
      fail(["lease has expired"]);
    }

    const task = await this.store.getTask(execution.task_id);
    if (!task) {
      fail([`task not found: ${execution.task_id}`]);
    }
    if (task.state !== "READY") {
      fail([`task state ${task.state} cannot receive a pre-execution ack`]);
    }
    const storedBinding = verifyContractBinding(task);
    if (!storedBinding.valid) {
      fail(storedBinding.errors);
    }

    const mission = await this.store.getMission(task.mission_id);
    if (!mission) {
      fail([`mission not found: ${task.mission_id}`]);
    }
    if (execution.mission_id !== task.mission_id || execution.mission_id !== mission.mission_id) {
      fail(["mission_id does not match stored execution/task"]);
    }
    if (execution.task_id !== task.task_id) {
      fail(["execution.task_id does not match stored task"]);
    }
    if (execution.contract_id !== task.contract_id) {
      fail(["execution.contract_id does not match stored task"]);
    }
    if (execution.base_sha !== task.base_sha) {
      fail(["execution.base_sha does not match stored task"]);
    }

    const assignment = await this.store.getAssignment(task.task_id);
    const correlation = validateCorrelation({
      mission,
      task,
      assignment,
      execution,
    });
    if (!correlation.valid) {
      fail(correlation.errors);
    }

    const readyToAuthorized = validateTransition("task", "READY", "AUTHORIZED");
    if (!readyToAuthorized.valid) {
      fail(readyToAuthorized.errors);
    }

    let nextTask = clone(task);
    nextTask.state = "AUTHORIZED";
    delete nextTask.contract_hash;
    nextTask = stampContractHash(nextTask);
    const nextBinding = verifyContractBinding(nextTask);
    if (!nextBinding.valid) {
      fail(nextBinding.errors);
    }
    const taskResult = validateDocument("task_contract", nextTask);
    if (!taskResult.valid) {
      fail(taskResult.errors);
    }

    const now = isoNow(this.clock);
    const ack = {
      record_kind: ACK_RECORD_KIND,
      mission_id: nextTask.mission_id,
      task_id: nextTask.task_id,
      execution_id: execution.execution_id,
      contract_id: nextTask.contract_id,
      contract_hash: nextTask.contract_hash,
      base_sha: execution.base_sha,
      acknowledged_by: acknowledgedBy,
      acknowledged_at: now,
      scope: "start_execution_only",
      substitutes_for_github_review: false,
      substitutes_for_human_approval: false,
      substitutes_for_merge: false,
      authority_claim: "none",
      input_role: "operational_start_authorization_only",
    };

    const transition = {
      schema_version: "0.5",
      document_kind: "lifecycle_transition",
      mission_id: nextTask.mission_id,
      task_id: nextTask.task_id,
      contract_id: nextTask.contract_id,
      contract_hash: nextTask.contract_hash,
      machine: "task",
      from_state: "READY",
      to_state: "AUTHORIZED",
      reason:
        "Human pre-execution acknowledgement. AUTHORIZED is operational start authorization, not GitHub approval or merge.",
      authority_claim: "none",
    };
    const transitionResult = validateDocument("lifecycle_transition", transition);
    if (!transitionResult.valid) {
      fail(transitionResult.errors);
    }

    const postCorrelation = validateCorrelation({
      mission,
      task: nextTask,
      assignment,
      execution,
    });
    if (!postCorrelation.valid) {
      fail(postCorrelation.errors);
    }

    if (execution.state !== "LEASED") {
      fail(["pre-execution ack must not start RUNNING"]);
    }

    // Fail-safe order: AUTHORIZED Task first, then transition, ack last.
    // An ack is never visible while Task remains READY. Q2 (multi-file
    // transaction) is not solved; runner must require BOTH ack and AUTHORIZED.
    await this.store.putTask(nextTask);
    await this.store.putTransition(transition, execution.execution_id, "READY-AUTHORIZED");
    await this.store.putPreExecutionAck(execution.execution_id, ack);

    return {
      ack: clone(ack),
      task: clone(nextTask),
      execution: clone(execution),
      transition: clone(transition),
    };
  }

  async getAuthorization(executionId) {
    assertCanonicalId("EXEC", executionId);
    const doc = await this.store.getPreExecutionAck(executionId);
    return doc ? clone(doc) : null;
  }

  /**
   * Future CursorExecutorTransport.startAgent MUST call this.
   * allowed === true is NOT GitHub approval. Spawn only when allowed.
   */
  async evaluateStartAuthorization(executionId) {
    try {
      assertCanonicalId("EXEC", executionId);
    } catch (err) {
      return denyStart([err.message || "invalid execution_id"]);
    }

    const reasons = [];
    const execution = await this.store.getExecution(executionId);
    if (!execution) {
      return denyStart([`execution not found: ${executionId}`]);
    }
    if (execution.state !== "LEASED") {
      reasons.push(`execution state ${execution.state} is not LEASED`);
    }
    if (leaseExpired(execution, this.clock())) {
      reasons.push("lease has expired");
    }

    const task = execution.task_id ? await this.store.getTask(execution.task_id) : null;
    if (!task) {
      return denyStart(["task not found"]);
    }
    if (task.state !== "AUTHORIZED") {
      reasons.push(`task state ${task.state} is not AUTHORIZED`);
    }
    const binding = verifyContractBinding(task);
    if (!binding.valid) {
      reasons.push(...binding.errors);
    }

    const ack = await this.store.getPreExecutionAck(executionId);
    if (!ack) {
      reasons.push("pre-execution ack missing");
    } else {
      if (ack.record_kind !== ACK_RECORD_KIND) {
        reasons.push("ack record_kind is invalid");
      }
      if (ack.authority_claim !== "none") {
        reasons.push("ack authority_claim is not none");
      }
      if (ack.scope !== "start_execution_only") {
        reasons.push("ack scope is not start_execution_only");
      }
      if (ack.execution_id !== execution.execution_id) {
        reasons.push("ack execution_id does not match execution");
      }
      if (ack.task_id !== task.task_id) {
        reasons.push("ack task_id does not match task");
      }
      if (ack.mission_id !== task.mission_id) {
        reasons.push("ack mission_id does not match task");
      }
      if (ack.contract_id !== task.contract_id) {
        reasons.push("ack contract_id does not match task");
      }
      if (ack.contract_hash !== task.contract_hash) {
        reasons.push("ack contract_hash does not match task");
      }
      if (ack.base_sha && ack.base_sha !== execution.base_sha) {
        reasons.push("ack base_sha does not match execution");
      }
      if (!ack.acknowledged_by || ack.acknowledged_by.kind !== "human") {
        reasons.push("ack acknowledged_by is not human");
      } else if (deniedIdentity(ack.acknowledged_by.identity)) {
        reasons.push("ack acknowledged_by is not a human operator identity");
      }
    }

    const mission = await this.store.getMission(task.mission_id);
    const assignment = await this.store.getAssignment(task.task_id);
    const correlation = validateCorrelation({
      mission,
      task,
      assignment,
      execution,
    });
    if (!correlation.valid) {
      reasons.push(...correlation.errors);
    }

    if (reasons.length) {
      return denyStart(reasons);
    }

    return {
      allowed: true,
      reasons: [],
      sufficient_for_authority: false,
      requires_live_github_approval: true,
      start_authorization: "AUTHORIZED",
      label: "Execution start authorization",
    };
  }
}

module.exports = {
  PreExecutionGateRuntime,
  DENIED_IDENTITIES,
};
