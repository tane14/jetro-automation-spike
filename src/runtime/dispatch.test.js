"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("os");
const path = require("path");
const { JsonFileMissionTaskStore } = require("./JsonFileMissionTaskStore");
const { MissionTaskRuntime, RuntimeValidationError } = require("./MissionTaskRuntime");
const { TaskDispatchRuntime } = require("./TaskDispatchRuntime");
const { StoredControlPlaneDataSource } = require("./StoredControlPlaneDataSource");
const {
  validateDocument,
  validateTransition,
  stampContractHash,
  verifyContractBinding,
} = require("../contracts");
const { assertCanonicalId } = require("./ids");

const BASE_SHA = "44887f243b1214bd9c946ecbcf6fead575b463a4";
const CLOCK = () => new Date("2026-08-28T22:00:00.000Z");

function tempEnv() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "jetro-dispatch-v08-"));
  const store = new JsonFileMissionTaskStore({ rootDir });
  const missions = new MissionTaskRuntime({ store, clock: CLOCK });
  const dispatch = new TaskDispatchRuntime({ store, clock: CLOCK });
  return { rootDir, store, missions, dispatch };
}

async function plannedTask(env) {
  const mission = await env.missions.createMission({
    title: "Dispatch v0.8 laboratory mission",
    base_sha: BASE_SHA,
    acceptance_criteria: ["Dispatch remains non-authoritative"],
  });
  const task = await env.missions.createTask({
    mission_id: mission.mission_id,
    acceptance_criteria: ["Task is dispatched as READY, not human authorized"],
  });
  return { mission, task };
}

async function expectFail(fn) {
  await assert.rejects(fn, RuntimeValidationError);
}

test("dispatch Task existente PLANNED → assignment, LEASED, READY, package", async () => {
  const env = tempEnv();
  const { task } = await plannedTask(env);
  const result = await env.dispatch.dispatchTask({
    task_id: task.task_id,
    assigned_to: { kind: "agent", identity: "cursor", role: "executor" },
  });
  assert.equal(result.assignment.authority_claim, "none");
  assert.equal(result.assignment.assigned_to.role, "executor");
  assert.equal(result.assignment.task_id, task.task_id);
  assert.equal(result.assignment.mission_id, task.mission_id);
  assert.equal(validateDocument("agent_assignment", result.assignment).valid, true);

  assert.equal(result.execution.state, "LEASED");
  assert.match(result.execution.execution_id, /^EXEC-20260828-[0-9]{3}$/);
  assert.equal(typeof result.execution.lease_token, "string");
  assert.ok(result.execution.lease_token.length >= 16);
  assert.equal(result.execution.authority_claim, "none");
  assert.equal(validateDocument("execution", result.execution).valid, true);

  assert.equal(result.task.state, "READY");
  assert.equal(result.transition.from_state, "PLANNED");
  assert.equal(result.transition.to_state, "READY");
  assert.equal(validateDocument("lifecycle_transition", result.transition).valid, true);
  assert.equal(validateTransition("task", "PLANNED", "READY").valid, true);

  const pkg = result.package;
  assert.equal(pkg.authority_claim, "none");
  assert.equal(pkg.input_role, "reference_only");
  assert.equal(pkg.substitutes_for_github_review, false);
  assert.equal(pkg.task_contract_hash, result.task.contract_hash);
  assert.equal(pkg.instructions.authority_claim, "none");
  assert.equal(pkg.instructions.input_role, "reference_only");
  assert.ok(pkg.mission && pkg.task && pkg.assignment && pkg.execution);
});

test("Task PLANNED adulterada após stamp (hash antigo) → FAIL closed, sem persistência", async () => {
  const env = tempEnv();
  const { task } = await plannedTask(env);
  const originalHash = task.contract_hash;
  assert.equal(verifyContractBinding(task).valid, true);

  const tampered = JSON.parse(JSON.stringify(task));
  tampered.acceptance_criteria = ["adversarial mutation after stamp"];
  assert.equal(tampered.contract_hash, originalHash);
  assert.equal(verifyContractBinding(tampered).valid, false);
  await env.store.putTask(tampered);

  await expectFail(() => env.dispatch.dispatchTask({ task_id: task.task_id }));

  const stored = await env.store.getTask(task.task_id);
  assert.equal(stored.state, "PLANNED");
  assert.equal(stored.contract_hash, originalHash);
  assert.deepEqual(stored.acceptance_criteria, ["adversarial mutation after stamp"]);
  assert.equal(await env.store.getAssignment(task.task_id), null);
  assert.equal((await env.store.listExecutionsByTask(task.task_id)).length, 0);
  assert.equal((await env.store.listExecutions()).length, 0);
  const jsonFiles = (dir) =>
    fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".json")) : [];
  assert.equal(jsonFiles(path.join(env.rootDir, "assignments")).length, 0);
  assert.equal(jsonFiles(path.join(env.rootDir, "executions")).length, 0);
  assert.equal(jsonFiles(path.join(env.rootDir, "transitions")).length, 0);
  assert.equal(jsonFiles(path.join(env.rootDir, "packages")).length, 0);

  const source = new StoredControlPlaneDataSource({ store: env.store });
  const detail = await source.getTaskDetail(task.task_id);
  assert.equal(detail.contractView.sufficientForAuthority, false);
  assert.equal(detail.contractView.requiresLiveGithubApproval, true);
  assert.notEqual(detail.contractView.approvalStatus, "approved");
});

test("Task inexistente → FAIL", async () => {
  const env = tempEnv();
  await expectFail(() =>
    env.dispatch.dispatchTask({
      task_id: "TASK-20260828-001",
      assigned_to: { kind: "agent", identity: "cursor", role: "executor" },
    }),
  );
});

test("PLANNED → AUTHORIZED and PLANNED → IN_PROGRESS are not performed", async () => {
  const env = tempEnv();
  const { task } = await plannedTask(env);
  await expectFail(() =>
    env.dispatch.dispatchTask({
      task_id: task.task_id,
      to_state: "AUTHORIZED",
    }),
  );
  await expectFail(() =>
    env.dispatch.dispatchTask({
      task_id: task.task_id,
      state: "IN_PROGRESS",
    }),
  );
  assert.equal(validateTransition("task", "PLANNED", "AUTHORIZED").valid, false);
  assert.equal(validateTransition("task", "PLANNED", "IN_PROGRESS").valid, false);
  const result = await env.dispatch.dispatchTask({ task_id: task.task_id });
  assert.equal(result.task.state, "READY");
  assert.notEqual(result.task.state, "AUTHORIZED");
  assert.notEqual(result.task.state, "IN_PROGRESS");
});

test("segundo lease ativo → FAIL; retry usa novo execution_id", async () => {
  const env = tempEnv();
  const { task } = await plannedTask(env);
  const first = await env.dispatch.dispatchTask({ task_id: task.task_id });
  await expectFail(() => env.dispatch.dispatchTask({ task_id: task.task_id }));
  const stillLeased = await env.dispatch.getExecution(first.execution.execution_id);
  stillLeased.state = "FAILED";
  delete stillLeased.lease_token;
  delete stillLeased.leased_at;
  delete stillLeased.lease_ttl_seconds;
  await env.store.putExecution(stillLeased);
  const second = await env.dispatch.dispatchTask({ task_id: task.task_id });
  assert.notEqual(second.execution.execution_id, first.execution.execution_id);
  assert.equal(second.execution.state, "LEASED");
  const listed = await env.dispatch.listExecutionsByTask(task.task_id);
  assert.equal(listed.length, 2);
  assert.equal(listed.filter((item) => item.state === "LEASED").length, 1);
});

test("correlações e getters do dispatch", async () => {
  const env = tempEnv();
  const { mission, task } = await plannedTask(env);
  const result = await env.dispatch.dispatchTask({ task_id: task.task_id });
  const assignment = await env.dispatch.getAssignment(task.task_id);
  const execution = await env.dispatch.getExecution(result.execution.execution_id);
  const pkg = await env.dispatch.getDispatchPackage(result.execution.execution_id);
  assert.equal(assignment.mission_id, mission.mission_id);
  assert.equal(execution.task_id, task.task_id);
  assert.equal(execution.contract_id, task.contract_id);
  assert.equal(pkg.task.mission_id, mission.mission_id);
  assert.equal(pkg.execution.execution_id, result.execution.execution_id);
});

test("package JSON válido, não Markdown, não autoridade", async () => {
  const env = tempEnv();
  const { task } = await plannedTask(env);
  const result = await env.dispatch.dispatchTask({ task_id: task.task_id });
  const pkgPath = path.join(env.rootDir, "packages", `${result.execution.execution_id}.json`);
  assert.equal(fs.existsSync(pkgPath), true);
  assert.equal(path.extname(pkgPath), ".json");
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });
  const files = walk(env.rootDir);
  assert.equal(files.some((file) => file.endsWith(".md")), false);
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  assert.notEqual(pkg.authority_claim, "human");
  assert.equal(pkg.input_role, "reference_only");
});

test("path traversal em execution_id → FAIL", async () => {
  const env = tempEnv();
  assert.throws(() => assertCanonicalId("EXEC", "../etc/passwd"));
  assert.throws(() => assertCanonicalId("EXEC", "EXEC-20260828-001/../../approvals"));
  await assert.rejects(() => env.dispatch.getExecution("../etc/passwd"));
  await assert.rejects(() => env.dispatch.getDispatchPackage("EXEC-20260828-001/../../x"));
});

test("planted APPROVED local não eleva authority", async () => {
  const env = tempEnv();
  const { mission, task } = await plannedTask(env);
  const planted = stampContractHash({
    ...task,
    state: "APPROVED",
  });
  await env.store.putTask(planted);
  const source = new StoredControlPlaneDataSource({ store: env.store });
  const detail = await source.getTaskDetail(task.task_id);
  assert.equal(detail.contractView.sufficientForAuthority, false);
  assert.equal(detail.contractView.requiresLiveGithubApproval, true);
  assert.equal(detail.contractView.approvalStatus, "invalid");
  assert.notEqual(detail.contractView.approvalStatus, "approved");
  await expectFail(() => env.dispatch.dispatchTask({ task_id: task.task_id }));
  assert.equal(mission.authority_claim, "none");
});

test("DataSource inclui assignment/execution; cadeia incompleta continua invalid", async () => {
  const env = tempEnv();
  const { task } = await plannedTask(env);
  const result = await env.dispatch.dispatchTask({ task_id: task.task_id });
  const source = new StoredControlPlaneDataSource({ store: env.store });
  const detail = await source.getTaskDetail(task.task_id);
  assert.ok(detail.contractView.bundle.assignment);
  assert.ok(detail.contractView.bundle.execution);
  assert.equal(detail.contractView.bundle.assignment.task_id, task.task_id);
  assert.equal(detail.contractView.bundle.execution.execution_id, result.execution.execution_id);
  assert.match(detail.contractView.handoffChain.find((s) => s.key === "assignment").summary, /not human approval/i);
  assert.equal(detail.contractView.chainConsistency, "invalid");
  assert.equal(detail.contractView.approvalStatus, "invalid");
  assert.equal(detail.contractView.sufficientForAuthority, false);
  assert.equal(detail.contractView.requiresLiveGithubApproval, true);
  assert.ok(
    detail.contractView.consistencyErrors.some((err) => err.includes("handoff chain missing")),
  );
});
