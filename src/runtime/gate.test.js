"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("os");
const path = require("path");
const { JsonFileMissionTaskStore } = require("./JsonFileMissionTaskStore");
const { MissionTaskRuntime, RuntimeValidationError } = require("./MissionTaskRuntime");
const { TaskDispatchRuntime } = require("./TaskDispatchRuntime");
const { PreExecutionGateRuntime } = require("./PreExecutionGateRuntime");
const { StoredControlPlaneDataSource } = require("./StoredControlPlaneDataSource");
const { stampContractHash, verifyContractBinding } = require("../contracts");
const { assertCanonicalId } = require("./ids");

const BASE_SHA = "3e62b4f78bd0996bf6651bcecb63817e2e3a6877";
const HUMAN = "MACHUB";
const CLI = path.join(__dirname, "cli.js");

function tempEnv(clock = () => new Date("2026-08-28T22:00:00.000Z")) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "jetro-preexec-v10-"));
  const store = new JsonFileMissionTaskStore({ rootDir });
  const missions = new MissionTaskRuntime({ store, clock });
  const dispatch = new TaskDispatchRuntime({ store, clock });
  const gate = new PreExecutionGateRuntime({ store, clock });
  return { rootDir, store, missions, dispatch, gate };
}

async function leaseReady(env) {
  const mission = await env.missions.createMission({
    title: "Pre-execution gate v1.0 laboratory mission",
    base_sha: BASE_SHA,
    acceptance_criteria: ["Ack is operational start authorization only"],
  });
  const task = await env.missions.createTask({
    mission_id: mission.mission_id,
    acceptance_criteria: ["AUTHORIZED is not GitHub approval"],
  });
  const result = await env.dispatch.dispatchTask({ task_id: task.task_id });
  return { mission, task: result.task, dispatched: result };
}

async function expectFail(fn) {
  await assert.rejects(fn, RuntimeValidationError);
}

test("READY + valid human ack → AUTHORIZED; execution stays LEASED", async () => {
  const env = tempEnv();
  const { task, dispatched } = await leaseReady(env);
  const before = await env.gate.evaluateStartAuthorization(dispatched.execution.execution_id);
  assert.equal(before.allowed, false);
  assert.equal(before.start_authorization, "NOT_AUTHORIZED");
  assert.equal((await env.store.getTask(task.task_id)).state, "READY");

  const result = await env.gate.authorizeExecution({
    execution_id: dispatched.execution.execution_id,
    acknowledged_by: HUMAN,
  });
  assert.equal(result.ack.record_kind, "pre_execution_ack");
  assert.equal(result.ack.authority_claim, "none");
  assert.equal(result.ack.scope, "start_execution_only");
  assert.equal(result.ack.substitutes_for_github_review, false);
  assert.equal(result.ack.acknowledged_by.kind, "human");
  assert.equal(result.ack.acknowledged_by.identity, HUMAN);
  assert.equal(result.task.state, "AUTHORIZED");
  assert.notEqual(result.task.state, "APPROVED");
  assert.equal(result.execution.state, "LEASED");
  assert.equal(result.transition.from_state, "READY");
  assert.equal(result.transition.to_state, "AUTHORIZED");
  assert.equal((await env.store.getExecution(dispatched.execution.execution_id)).state, "LEASED");

  const predicate = await env.gate.evaluateStartAuthorization(dispatched.execution.execution_id);
  assert.equal(predicate.allowed, true);
  assert.equal(predicate.sufficient_for_authority, false);
  assert.equal(predicate.requires_live_github_approval, true);
  assert.equal(predicate.label, "Execution start authorization");

  const walk = (dir) =>
    fs.existsSync(dir)
      ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
          const full = path.join(dir, entry.name);
          return entry.isDirectory() ? walk(full) : [full];
        })
      : [];
  assert.equal(walk(env.rootDir).some((file) => file.endsWith(".md")), false);
});

test("non-human identities cannot ack", async () => {
  const env = tempEnv();
  const { dispatched } = await leaseReady(env);
  const id = dispatched.execution.execution_id;
  for (const identity of ["executor", "cursor", "claude", "gpt", "chatgpt", "system", "automation"]) {
    await expectFail(() =>
      env.gate.authorizeExecution({ execution_id: id, acknowledged_by: identity }),
    );
  }
  await expectFail(() =>
    env.gate.authorizeExecution({
      execution_id: id,
      acknowledged_by: { kind: "agent", identity: "MACHUB" },
    }),
  );
  assert.equal((await env.store.getTask(dispatched.task.task_id)).state, "READY");
  assert.equal(await env.gate.getAuthorization(id), null);
});

test("reviewer/ci/runner/pipeline/service/github-actions cannot ack", async () => {
  const env = tempEnv();
  const { dispatched } = await leaseReady(env);
  const id = dispatched.execution.execution_id;
  for (const identity of [
    "reviewer",
    "Reviewer",
    "REVIEWER",
    "ci",
    "runner",
    "pipeline",
    "service",
    "github-actions",
  ]) {
    await expectFail(() =>
      env.gate.authorizeExecution({ execution_id: id, acknowledged_by: identity }),
    );
  }
  assert.equal(await env.gate.getAuthorization(id), null);
  assert.equal((await env.store.getTask(dispatched.task.task_id)).state, "READY");
  assert.equal((await env.store.getExecution(id)).state, "LEASED");
  const predicate = await env.gate.evaluateStartAuthorization(id);
  assert.equal(predicate.allowed, false);
});

test("correlation, lease, state, duplicate, replay → FAIL", async () => {
  const env = tempEnv();
  const first = await leaseReady(env);
  const id = first.dispatched.execution.execution_id;

  await expectFail(() =>
    env.gate.authorizeExecution({
      execution_id: "EXEC-20260828-999",
      acknowledged_by: HUMAN,
    }),
  );

  const stolenHash = JSON.parse(JSON.stringify(first.dispatched.execution));
  stolenHash.contract_id = "CONTRACT-20260828-999";
  await env.store.putExecution(stolenHash);
  await expectFail(() =>
    env.gate.authorizeExecution({ execution_id: id, acknowledged_by: HUMAN }),
  );
  await env.store.putExecution(first.dispatched.execution);

  const other = await leaseReady(env);
  const mismatched = await env.store.getExecution(id);
  mismatched.mission_id = other.mission.mission_id;
  await env.store.putExecution(mismatched);
  await expectFail(() =>
    env.gate.authorizeExecution({ execution_id: id, acknowledged_by: HUMAN }),
  );
  await env.store.putExecution(first.dispatched.execution);

  const tampered = JSON.parse(JSON.stringify(first.task));
  tampered.acceptance_criteria = ["stale mutation after stamp"];
  assert.equal(verifyContractBinding(tampered).valid, false);
  await env.store.putTask(tampered);
  await expectFail(() =>
    env.gate.authorizeExecution({ execution_id: id, acknowledged_by: HUMAN }),
  );
  await env.store.putTask(first.task);

  const running = await env.store.getExecution(id);
  running.state = "RUNNING";
  await env.store.putExecution(running);
  await expectFail(() =>
    env.gate.authorizeExecution({ execution_id: id, acknowledged_by: HUMAN }),
  );
  running.state = "LEASED";
  await env.store.putExecution(running);

  let now = new Date("2026-08-28T22:00:00.000Z");
  const expiredEnv = tempEnv(() => now);
  const expired = await leaseReady(expiredEnv);
  now = new Date("2026-08-28T23:00:01.000Z");
  await expectFail(() =>
    expiredEnv.gate.authorizeExecution({
      execution_id: expired.dispatched.execution.execution_id,
      acknowledged_by: HUMAN,
    }),
  );

  const ok = await env.gate.authorizeExecution({ execution_id: id, acknowledged_by: HUMAN });
  assert.equal(ok.task.state, "AUTHORIZED");
  await expectFail(() =>
    env.gate.authorizeExecution({ execution_id: id, acknowledged_by: HUMAN }),
  );

  const plantedReplay = JSON.parse(JSON.stringify(ok.ack));
  await env.store.putPreExecutionAck(other.dispatched.execution.execution_id, plantedReplay);
  const replay = await env.gate.evaluateStartAuthorization(other.dispatched.execution.execution_id);
  assert.equal(replay.allowed, false);
});

test("path traversal → FAIL", async () => {
  const env = tempEnv();
  assert.throws(() => assertCanonicalId("EXEC", "../etc/passwd"));
  await assert.rejects(() =>
    env.gate.authorizeExecution({ execution_id: "../etc/passwd", acknowledged_by: HUMAN }),
  );
  await assert.rejects(() => env.gate.getAuthorization("EXEC-20260828-001/../../acks"));
});

test("planted ack or AUTHORIZED alone cannot start; DataSource labels operational gate", async () => {
  const env = tempEnv();
  const { task, dispatched } = await leaseReady(env);
  const id = dispatched.execution.execution_id;

  await env.store.putPreExecutionAck(id, {
    record_kind: "pre_execution_ack",
    mission_id: task.mission_id,
    task_id: task.task_id,
    execution_id: id,
    contract_id: task.contract_id,
    contract_hash: task.contract_hash,
    base_sha: dispatched.execution.base_sha,
    acknowledged_by: { kind: "human", identity: HUMAN },
    acknowledged_at: "2026-08-28T22:00:00Z",
    scope: "start_execution_only",
    authority_claim: "none",
  });
  const ackOnly = await env.gate.evaluateStartAuthorization(id);
  assert.equal(ackOnly.allowed, false);
  assert.equal((await env.store.getTask(task.task_id)).state, "READY");

  const clean = tempEnv();
  const ready = await leaseReady(clean);
  const plantedAuthorized = stampContractHash({ ...ready.task, state: "AUTHORIZED" });
  await clean.store.putTask(plantedAuthorized);
  const authOnly = await clean.gate.evaluateStartAuthorization(ready.dispatched.execution.execution_id);
  assert.equal(authOnly.allowed, false);

  const okEnv = tempEnv();
  const ok = await leaseReady(okEnv);
  await okEnv.gate.authorizeExecution({
    execution_id: ok.dispatched.execution.execution_id,
    acknowledged_by: HUMAN,
  });
  const source = new StoredControlPlaneDataSource({ store: okEnv.store });
  const detail = await source.getTaskDetail(ok.task.task_id);
  assert.equal(detail.contractView.preExecutionAuthorization.status, "AUTHORIZED");
  assert.equal(detail.contractView.preExecutionAuthorization.label, "Execution start authorization");
  assert.match(detail.contractView.preExecutionAuthorization.summary, /not pr approved/i);
  assert.equal(detail.contractView.sufficientForAuthority, false);
  assert.equal(detail.contractView.requiresLiveGithubApproval, true);
  assert.notEqual(detail.contractView.approvalStatus, "approved");
  assert.equal(detail.contractView.lifecycleState, "AUTHORIZED");
});

test("CLI authorize is human-triggered and is not GitHub approval", async () => {
  const env = tempEnv(() => new Date());
  const { dispatched } = await leaseReady(env);
  const ran = spawnSync(
    process.execPath,
    [
      CLI,
      "authorize",
      "--execution-id",
      dispatched.execution.execution_id,
      "--acknowledged-by",
      HUMAN,
      "--root",
      env.rootDir,
    ],
    { encoding: "utf8" },
  );
  assert.equal(ran.status, 0, ran.stderr);
  const body = JSON.parse(ran.stdout);
  assert.equal(body.task_state, "AUTHORIZED");
  assert.equal(body.execution_state, "LEASED");
  assert.equal(body.start_authorization, "AUTHORIZED");
  assert.equal(body.authority_claim, "none");
  assert.equal(body.substitutes_for_github_review, false);
  assert.match(body.note, /not pr approved/i);
  assert.equal(ran.stdout.toLowerCase().includes("github approved"), false);
});
