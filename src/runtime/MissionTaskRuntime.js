"use strict";

/**
 * Local Mission/Task runtime v0.7.
 *
 * Creates and reads canonical Contracts v0.5 Mission and Task documents.
 * Does not grant authority, lease, execute, approve, or merge.
 * Does not decompose missions; the orchestrator/human supplies each Task.
 *
 * valid:true is never authorized:true. Local JSON is never GitHub approval.
 */

const {
  validateDocument,
  stampContractHash,
  verifyContractBinding,
  validateCorrelation,
  NOT_AUTHORITY,
} = require("../contracts");
const { assertStore } = require("./MissionTaskStore");
const { utcDateStamp, nextId, assertCanonicalId } = require("./ids");

const FORBIDDEN_CREATE_STATES = new Set([
  "AUTHORIZED",
  "APPROVED",
  "MERGE_READY",
  "MERGED",
]);

const DEFAULT_DENIED_TARGETS = [
  "vps",
  "production",
  "jetro",
  "ibe",
  "database",
  "scheduler",
  "automatic_agent",
  "http_api",
  "github_integration_runtime",
  "merge",
];

const DEFAULT_ALLOWED_PATH_GLOBS = [
  ".github/*",
  "control-plane/*",
  "src/*",
  "README.md",
  ".gitignore",
];

const DEFAULT_POLICY_REFS = [
  {
    policy_version: "approval-provenance-v0.4",
    check_name: "approval-provenance",
  },
];

const MISSION_INPUT_KEYS = new Set([
  "title",
  "description",
  "base_sha",
  "scope_boundaries",
  "acceptance_criteria",
  "mission_id",
  "state",
  "authority_claim",
]);

const TASK_INPUT_KEYS = new Set([
  "mission_id",
  "acceptance_criteria",
  "assigned_to",
  "base_sha",
  "scope_boundaries",
  "policy_refs",
  "evidence_refs",
  "task_id",
  "contract_id",
  "state",
  "authority_claim",
  "source_role",
  "target_role",
]);

class RuntimeValidationError extends Error {
  constructor(errors) {
    const list = Array.isArray(errors) ? errors.filter(Boolean) : [String(errors)];
    super(list.join("; "));
    this.name = "RuntimeValidationError";
    this.errors = list;
    this.valid = false;
    this.sufficient_for_authority = false;
    this.requires_live_github_approval = true;
  }
}

function fail(errors) {
  throw new RuntimeValidationError(errors);
}

function unknownKeys(input, allowed) {
  return Object.keys(input || {}).filter((key) => !allowed.has(key));
}

function rejectCreateAuthority(input, label) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail([`${label} input must be an object`]);
  }
  if (Object.prototype.hasOwnProperty.call(input, "authority_claim")) {
    if (input.authority_claim !== "none") {
      fail([`${label} authority_claim must be none`]);
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, "state")) {
    if (FORBIDDEN_CREATE_STATES.has(input.state)) {
      fail([`${label} cannot be created in ${input.state}`]);
    }
    if (input.state !== "PLANNED") {
      fail([`${label} create is limited to PLANNED (got ${input.state})`]);
    }
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class MissionTaskRuntime {
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

  async createMission(input = {}) {
    rejectCreateAuthority(input, "mission");
    const extra = unknownKeys(input, MISSION_INPUT_KEYS);
    if (extra.length) {
      fail([`unknown mission input field: ${extra.join(", ")}`]);
    }
    if (typeof input.title !== "string" || input.title.trim() === "") {
      fail(["mission title is required"]);
    }
    if (typeof input.base_sha !== "string" || !/^[a-f0-9]{40}$/.test(input.base_sha)) {
      fail(["mission base_sha must be a 40-character lowercase git SHA"]);
    }
    if (!Array.isArray(input.acceptance_criteria) || input.acceptance_criteria.length < 1) {
      fail(["mission acceptance_criteria must be a non-empty array"]);
    }

    const existing = await this.store.listMissions();
    const existingIds = existing.map((doc) => doc.mission_id);
    let missionId = input.mission_id;
    if (missionId) {
      assertCanonicalId("MISSION", missionId);
      if (existingIds.includes(missionId) || (await this.store.getMission(missionId))) {
        fail([`mission id collision: ${missionId}`]);
      }
    } else {
      missionId = nextId("MISSION", this.#stampDate(), existingIds);
    }

    const scope = input.scope_boundaries
      ? clone(input.scope_boundaries)
      : {
          allowed_path_globs: DEFAULT_ALLOWED_PATH_GLOBS.slice(),
          denied_targets: DEFAULT_DENIED_TARGETS.slice(),
        };

    const doc = {
      schema_version: "0.5",
      mission_id: missionId,
      title: input.title,
      state: "PLANNED",
      base_sha: input.base_sha,
      scope_boundaries: scope,
      acceptance_criteria: clone(input.acceptance_criteria),
      task_ids: [],
      authority_claim: "none",
    };
    if (typeof input.description === "string" && input.description.trim() !== "") {
      doc.description = input.description;
    }

    const result = validateDocument("mission", doc);
    if (!result.valid) {
      fail(result.errors);
    }
    await this.store.putMission(doc);
    return clone(doc);
  }

  async getMission(missionId) {
    assertCanonicalId("MISSION", missionId);
    const doc = await this.store.getMission(missionId);
    return doc ? clone(doc) : null;
  }

  async listMissions() {
    const docs = await this.store.listMissions();
    return docs.map((doc) => clone(doc));
  }

  async createTask(input = {}) {
    rejectCreateAuthority(input, "task");
    const extra = unknownKeys(input, TASK_INPUT_KEYS);
    if (extra.length) {
      fail([`unknown task input field: ${extra.join(", ")}`]);
    }
    if (Object.prototype.hasOwnProperty.call(input, "source_role") && input.source_role !== "orchestrator") {
      fail(["task source_role must be orchestrator"]);
    }
    if (Object.prototype.hasOwnProperty.call(input, "target_role") && input.target_role !== "executor") {
      fail(["task target_role must be executor"]);
    }
    if (typeof input.mission_id !== "string") {
      fail(["task requires mission_id"]);
    }
    assertCanonicalId("MISSION", input.mission_id);
    const mission = await this.store.getMission(input.mission_id);
    if (!mission) {
      fail([`mission not found: ${input.mission_id}`]);
    }
    if (!Array.isArray(input.acceptance_criteria) || input.acceptance_criteria.length < 1) {
      fail(["task acceptance_criteria must be a non-empty array"]);
    }

    const existingTasks = await this.store.listTasks();
    const existingTaskIds = existingTasks.map((doc) => doc.task_id);
    const existingContractIds = existingTasks.map((doc) => doc.contract_id).filter(Boolean);
    const dateStamp = this.#stampDate();

    let taskId = input.task_id;
    if (taskId) {
      assertCanonicalId("TASK", taskId);
      if (existingTaskIds.includes(taskId) || (await this.store.getTask(taskId))) {
        fail([`task id collision: ${taskId}`]);
      }
    } else {
      taskId = nextId("TASK", dateStamp, existingTaskIds);
    }

    let contractId = input.contract_id;
    if (contractId) {
      assertCanonicalId("CONTRACT", contractId);
      if (existingContractIds.includes(contractId)) {
        fail([`contract id collision: ${contractId}`]);
      }
    } else {
      contractId = nextId("CONTRACT", dateStamp, existingContractIds);
    }

    const assignedTo = input.assigned_to
      ? clone(input.assigned_to)
      : { kind: "agent", identity: "cursor", role: "executor" };

    const doc = {
      schema_version: "0.5",
      document_kind: "task_contract",
      mission_id: mission.mission_id,
      task_id: taskId,
      contract_id: contractId,
      state: "PLANNED",
      base_sha: input.base_sha || mission.base_sha,
      scope_boundaries: input.scope_boundaries
        ? clone(input.scope_boundaries)
        : clone(mission.scope_boundaries),
      acceptance_criteria: clone(input.acceptance_criteria),
      assigned_to: assignedTo,
      source_role: "orchestrator",
      target_role: "executor",
      policy_refs: input.policy_refs ? clone(input.policy_refs) : clone(DEFAULT_POLICY_REFS),
      authority_claim: "none",
    };
    if (input.evidence_refs) {
      doc.evidence_refs = clone(input.evidence_refs);
    }

    const stamped = stampContractHash(doc);
    const binding = verifyContractBinding(stamped);
    if (!binding.valid) {
      fail(binding.errors);
    }
    const result = validateDocument("task_contract", stamped);
    if (!result.valid) {
      fail(result.errors);
    }
    const correlation = validateCorrelation({ mission, task: stamped });
    if (!correlation.valid) {
      fail(correlation.errors);
    }

    const nextMission = clone(mission);
    const taskIds = Array.isArray(nextMission.task_ids) ? nextMission.task_ids.slice() : [];
    if (!taskIds.includes(stamped.task_id)) {
      taskIds.push(stamped.task_id);
    }
    nextMission.task_ids = taskIds;
    const missionResult = validateDocument("mission", nextMission);
    if (!missionResult.valid) {
      fail(missionResult.errors);
    }

    await this.store.putTask(stamped);
    await this.store.putMission(nextMission);
    return clone(stamped);
  }

  async getTask(taskId) {
    assertCanonicalId("TASK", taskId);
    const doc = await this.store.getTask(taskId);
    return doc ? clone(doc) : null;
  }

  async listTasks() {
    const docs = await this.store.listTasks();
    return docs.map((doc) => clone(doc));
  }

  async listTasksByMission(missionId) {
    assertCanonicalId("MISSION", missionId);
    const docs = await this.store.listTasksByMission(missionId);
    return docs.map((doc) => clone(doc));
  }
}

module.exports = {
  MissionTaskRuntime,
  RuntimeValidationError,
  FORBIDDEN_CREATE_STATES,
  DEFAULT_DENIED_TARGETS,
  NOT_AUTHORITY,
};
