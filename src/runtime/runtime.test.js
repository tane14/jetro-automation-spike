"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { JsonFileMissionTaskStore } = require("./JsonFileMissionTaskStore");
const {
  MissionTaskRuntime,
  RuntimeValidationError,
} = require("./MissionTaskRuntime");
const { StoredControlPlaneDataSource } = require("./StoredControlPlaneDataSource");
const {
  validateDocument,
  verifyContractBinding,
  stampContractHash,
} = require("../contracts");

const BASE_SHA = "19473c94e59ad58e25ed9c2dab1158af64b96577";
const CLOCK = () => new Date("2026-08-28T22:00:00.000Z");

function tempStore() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "jetro-runtime-v07-"));
  const store = new JsonFileMissionTaskStore({ rootDir });
  const runtime = new MissionTaskRuntime({ store, clock: CLOCK });
  return { rootDir, store, runtime };
}

function missionInput(overrides = {}) {
  return {
    title: "Runtime v0.7 laboratory mission",
    description: "Local persistence of canonical Mission/Task contracts.",
    base_sha: BASE_SHA,
    acceptance_criteria: ["Mission documents remain non-authoritative"],
    ...overrides,
  };
}

function taskInput(missionId, overrides = {}) {
  return {
    mission_id: missionId,
    acceptance_criteria: ["Task remains PLANNED and non-authoritative"],
    ...overrides,
  };
}

async function expectFail(fn) {
  await assert.rejects(fn, RuntimeValidationError);
}

test("createMission produces a schema-valid PLANNED document with authority_claim none", async () => {
  const { runtime } = tempStore();
  const mission = await runtime.createMission(missionInput());
  assert.equal(mission.schema_version, "0.5");
  assert.equal(mission.state, "PLANNED");
  assert.equal(mission.authority_claim, "none");
  assert.equal(mission.base_sha, BASE_SHA);
  assert.match(mission.mission_id, /^MISSION-20260828-[0-9]{3}$/);
  const result = validateDocument("mission", mission);
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.equal(result.sufficient_for_authority, false);
  assert.equal(result.requires_live_github_approval, true);
});

test("createTask requires an existing mission and preserves mission_id", async () => {
  const { runtime } = tempStore();
  await expectFail(() => runtime.createTask(taskInput("MISSION-20260828-001")));
  const mission = await runtime.createMission(missionInput());
  const task = await runtime.createTask(taskInput(mission.mission_id));
  assert.equal(task.mission_id, mission.mission_id);
  assert.equal(task.state, "PLANNED");
  assert.equal(task.authority_claim, "none");
  assert.equal(task.source_role, "orchestrator");
  assert.equal(task.target_role, "executor");
  const listed = await runtime.listTasksByMission(mission.mission_id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].task_id, task.task_id);
  const fetchedMission = await runtime.getMission(mission.mission_id);
  assert.ok(fetchedMission.task_ids.includes(task.task_id));
});

test("createTask stamps a canonical contract_hash that verifies", async () => {
  const { runtime } = tempStore();
  const mission = await runtime.createMission(missionInput());
  const task = await runtime.createTask(taskInput(mission.mission_id));
  const binding = verifyContractBinding(task);
  assert.equal(binding.valid, true, binding.errors.join("; "));
  const restamped = stampContractHash(task);
  assert.equal(restamped.contract_hash, task.contract_hash);
  const result = validateDocument("task_contract", task);
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.equal(result.sufficient_for_authority, false);
});

test("id collision fails closed", async () => {
  const { runtime } = tempStore();
  const first = await runtime.createMission(
    missionInput({ mission_id: "MISSION-20260828-042" }),
  );
  await expectFail(() =>
    runtime.createMission(missionInput({ mission_id: "MISSION-20260828-042" })),
  );
  const task = await runtime.createTask(
    taskInput(first.mission_id, { task_id: "TASK-20260828-007" }),
  );
  assert.equal(task.task_id, "TASK-20260828-007");
  await expectFail(() =>
    runtime.createTask(taskInput(first.mission_id, { task_id: "TASK-20260828-007" })),
  );
});

test("listTasksByMission does not mix missions", async () => {
  const { runtime } = tempStore();
  const a = await runtime.createMission(missionInput({ title: "Mission A" }));
  const b = await runtime.createMission(missionInput({ title: "Mission B" }));
  const taskA = await runtime.createTask(taskInput(a.mission_id));
  const taskB = await runtime.createTask(taskInput(b.mission_id));
  const listedA = await runtime.listTasksByMission(a.mission_id);
  const listedB = await runtime.listTasksByMission(b.mission_id);
  assert.deepEqual(
    listedA.map((item) => item.task_id),
    [taskA.task_id],
  );
  assert.deepEqual(
    listedB.map((item) => item.task_id),
    [taskB.task_id],
  );
  assert.equal((await runtime.listTasks()).length, 2);
  assert.equal((await runtime.listMissions()).length, 2);
  assert.equal((await runtime.getTask(taskA.task_id)).mission_id, a.mission_id);
});

test("authority_claim other than none fails", async () => {
  const { runtime } = tempStore();
  await expectFail(() =>
    runtime.createMission(missionInput({ authority_claim: "human_authority" })),
  );
  const mission = await runtime.createMission(missionInput());
  await expectFail(() =>
    runtime.createTask(
      taskInput(mission.mission_id, { authority_claim: "approved" }),
    ),
  );
});

test("creating AUTHORIZED or APPROVED fails", async () => {
  const { runtime } = tempStore();
  await expectFail(() => runtime.createMission(missionInput({ state: "AUTHORIZED" })));
  const mission = await runtime.createMission(missionInput());
  await expectFail(() =>
    runtime.createTask(taskInput(mission.mission_id, { state: "AUTHORIZED" })),
  );
  await expectFail(() =>
    runtime.createTask(taskInput(mission.mission_id, { state: "APPROVED" })),
  );
  await expectFail(() =>
    runtime.createTask(taskInput(mission.mission_id, { state: "MERGE_READY" })),
  );
});

test("extra or schema-invalid fields fail closed", async () => {
  const { runtime } = tempStore();
  await expectFail(() =>
    runtime.createMission(missionInput({ github_approved: true })),
  );
  await expectFail(() => runtime.createMission(missionInput({ base_sha: "not-a-sha" })));
  const mission = await runtime.createMission(missionInput());
  await expectFail(() =>
    runtime.createTask(taskInput(mission.mission_id, { lease_token: "x".repeat(16) })),
  );
  await expectFail(() =>
    runtime.createTask(
      taskInput(mission.mission_id, {
        assigned_to: { kind: "agent", identity: "cursor", role: "human_authority" },
      }),
    ),
  );
});

test("post-stamp mutation with stolen hash fails closed", async () => {
  const { runtime } = tempStore();
  const mission = await runtime.createMission(missionInput());
  const task = await runtime.createTask(taskInput(mission.mission_id));
  const stolen = JSON.parse(JSON.stringify(task));
  stolen.acceptance_criteria = ["adversarial mutation after stamp"];
  const binding = verifyContractBinding(stolen);
  assert.equal(binding.valid, false);
  assert.ok(
    binding.errors.some((err) => err.includes("contract_hash does not match canonical digest")),
  );
  const result = validateDocument("task_contract", stolen);
  assert.equal(result.valid, false);
  assert.notEqual(result.valid, true);
  assert.equal(result.sufficient_for_authority, false);
});

test("StoredControlPlaneDataSource projects through the existing adapter without granting authority", async () => {
  const { store, runtime } = tempStore();
  const mission = await runtime.createMission(missionInput());
  const task = await runtime.createTask(taskInput(mission.mission_id));
  const source = new StoredControlPlaneDataSource({ store });
  const missions = await source.listMissions();
  assert.equal(missions.length, 1);
  assert.equal(missions[0].id, mission.mission_id);
  assert.deepEqual(missions[0].taskIds, [task.task_id]);
  const listed = await source.listTasks();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, task.task_id);
  assert.equal(listed[0].chainConsistency, "invalid");
  const detail = await source.getTaskDetail(task.task_id);
  assert.ok(detail);
  assert.equal(detail.contractView.sufficientForAuthority, false);
  assert.equal(detail.contractView.requiresLiveGithubApproval, true);
  assert.equal(detail.contractView.approvalStatus, "invalid");
  assert.notEqual(detail.contractView.approvalStatus, "approved");
  assert.equal(detail.contractView.chainConsistency, "invalid");
  assert.ok(
    detail.contractView.consistencyErrors.some((err) =>
      err.includes("handoff chain missing"),
    ),
  );
});

test("JsonFileMissionTaskStore writes one JSON document per file and never markdown", async () => {
  const { rootDir, runtime } = tempStore();
  const mission = await runtime.createMission(missionInput());
  const task = await runtime.createTask(taskInput(mission.mission_id));
  const missionFile = path.join(rootDir, "missions", `${mission.mission_id}.json`);
  const taskFile = path.join(rootDir, "tasks", `${task.task_id}.json`);
  assert.equal(fs.existsSync(missionFile), true);
  assert.equal(fs.existsSync(taskFile), true);
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });
  const files = walk(rootDir);
  assert.equal(
    files.every((file) => file.endsWith(".json") || file.endsWith(".json.tmp")),
    true,
  );
  assert.equal(
    files.some((file) => file.endsWith(".md")),
    false,
  );
});
