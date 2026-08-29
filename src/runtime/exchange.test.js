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
const { ExecutorExchangeRuntime } = require("./ExecutorExchangeRuntime");
const { StoredControlPlaneDataSource } = require("./StoredControlPlaneDataSource");
const { stampContractHash, verifyContractBinding, validateDocument } = require("../contracts");
const { assertCanonicalId } = require("./ids");

const BASE_SHA = "36fdb648b134844c48c1d58e4e9b71c53a5c14fa";
const HEAD_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CLI = path.join(__dirname, "cli.js");

function tempEnv(clock = () => new Date("2026-08-28T22:00:00.000Z")) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "jetro-exchange-v09-"));
  const store = new JsonFileMissionTaskStore({ rootDir });
  const missions = new MissionTaskRuntime({ store, clock });
  const dispatch = new TaskDispatchRuntime({ store, clock });
  const exchange = new ExecutorExchangeRuntime({ store, clock });
  return { rootDir, store, missions, dispatch, exchange, clock };
}

async function leaseReady(env) {
  const mission = await env.missions.createMission({
    title: "Executor exchange v0.9 laboratory mission",
    base_sha: BASE_SHA,
    acceptance_criteria: ["Exchange remains non-authoritative"],
  });
  const task = await env.missions.createTask({
    mission_id: mission.mission_id,
    acceptance_criteria: ["Handoff is an executor result, not approval"],
  });
  const result = await env.dispatch.dispatchTask({ task_id: task.task_id });
  return { mission, task: result.task, dispatched: result };
}

function successHandoff(overrides = {}) {
  return {
    outcome: "SUCCESS",
    self_reported_summary: "Implemented local exchange ingest. Informational only.",
    files_changed: ["src/runtime/ExecutorExchangeRuntime.js"],
    pr_number: 25,
    head_sha: HEAD_SHA,
    ...overrides,
  };
}

async function expectFail(fn) {
  await assert.rejects(fn, RuntimeValidationError);
}

function jsonFiles(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".json")) : [];
}

test("export LEASED package → JSON outbox, not Markdown", async () => {
  const env = tempEnv();
  const { dispatched } = await leaseReady(env);
  const exported = await env.exchange.exportDispatchPackage({
    execution_id: dispatched.execution.execution_id,
  });
  assert.equal(path.extname(exported.path), ".json");
  assert.ok(exported.path.replace(/\\/g, "/").includes("/exchange/outbox/"));
  assert.equal(fs.existsSync(exported.path), true);
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });
  assert.equal(
    walk(path.join(env.rootDir, "exchange")).some((file) => file.endsWith(".md")),
    false,
  );
  assert.equal(exported.package.authority_claim, "none");
  const stillLeased = await env.store.getExecution(dispatched.execution.execution_id);
  assert.equal(stillLeased.state, "LEASED");
  const tamperedPkg = await env.store.getPackage(dispatched.execution.execution_id);
  tamperedPkg.task.contract_hash = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  await env.store.putPackage(dispatched.execution.execution_id, tamperedPkg);
  await expectFail(() =>
    env.exchange.exportDispatchPackage({ execution_id: dispatched.execution.execution_id }),
  );
});

test("SUCCESS válido → RESULT_SUBMITTED, Task READY, roles canónicos", async () => {
  const env = tempEnv();
  const { task, dispatched } = await leaseReady(env);
  const result = await env.exchange.ingestHandoff({
    execution_id: dispatched.execution.execution_id,
    lease_token: dispatched.execution.lease_token,
    handoff: successHandoff(),
  });
  assert.equal(result.handoff.document_kind, "execution_handoff");
  assert.equal(result.handoff.authority_claim, "none");
  assert.equal(result.handoff.source_role, "executor");
  assert.equal(result.handoff.target_role, "reviewer");
  assert.equal(result.handoff.summary_role, "informational_only");
  assert.equal(result.handoff.execution_id, dispatched.execution.execution_id);
  assert.equal(Object.prototype.hasOwnProperty.call(result.handoff, "lease_token"), false);
  assert.equal(validateDocument("execution_handoff", result.handoff).valid, true);

  assert.equal(result.execution.state, "RESULT_SUBMITTED");
  assert.equal(result.execution.outcome, "SUCCESS");
  assert.equal(result.execution.lease_token, undefined);
  assert.equal(validateDocument("execution", result.execution).valid, true);

  assert.equal(result.task.state, "READY");
  assert.equal((await env.store.getTask(task.task_id)).state, "READY");

  assert.equal(result.transitions.length, 2);
  assert.equal(result.transitions[0].from_state, "LEASED");
  assert.equal(result.transitions[0].to_state, "RUNNING");
  assert.equal(result.transitions[1].from_state, "RUNNING");
  assert.equal(result.transitions[1].to_state, "RESULT_SUBMITTED");

  const storedHandoff = await env.exchange.getHandoff(dispatched.execution.execution_id);
  assert.equal(storedHandoff.outcome, "SUCCESS");
  const listed = await env.exchange.listHandoffsByTask(task.task_id);
  assert.equal(listed.length, 1);
  assert.equal(jsonFiles(path.join(env.rootDir, "handoffs")).length, 1);
  assert.equal(jsonFiles(path.join(env.rootDir, "exchange", "inbox")).length, 1);
});

test("SUCCESS exige pr_number + head_sha", async () => {
  const env = tempEnv();
  const { dispatched } = await leaseReady(env);
  await expectFail(() =>
    env.exchange.ingestHandoff({
      execution_id: dispatched.execution.execution_id,
      lease_token: dispatched.execution.lease_token,
      handoff: successHandoff({ pr_number: undefined, head_sha: undefined }),
    }),
  );
  await expectFail(() =>
    env.exchange.ingestHandoff({
      execution_id: dispatched.execution.execution_id,
      lease_token: dispatched.execution.lease_token,
      handoff: { outcome: "SUCCESS", self_reported_summary: "missing pr and head" },
    }),
  );
  assert.equal(await env.exchange.getHandoff(dispatched.execution.execution_id), null);
  assert.equal((await env.store.getExecution(dispatched.execution.execution_id)).state, "LEASED");
});

test("segundo ingest → FAIL; RUNNING → RESULT_SUBMITTED", async () => {
  const env = tempEnv();
  const { dispatched } = await leaseReady(env);
  const running = await env.store.getExecution(dispatched.execution.execution_id);
  running.state = "RUNNING";
  await env.store.putExecution(running);
  const first = await env.exchange.ingestHandoff({
    execution_id: dispatched.execution.execution_id,
    lease_token: dispatched.execution.lease_token,
    handoff: successHandoff(),
  });
  assert.equal(first.transitions.length, 1);
  assert.equal(first.transitions[0].from_state, "RUNNING");
  await expectFail(() =>
    env.exchange.ingestHandoff({
      execution_id: dispatched.execution.execution_id,
      lease_token: dispatched.execution.lease_token,
      handoff: successHandoff(),
    }),
  );
});

test("correlação e lease: wrong ids/hash/token/TTL → FAIL", async () => {
  const env = tempEnv();
  const { dispatched } = await leaseReady(env);
  const id = dispatched.execution.execution_id;
  const token = dispatched.execution.lease_token;

  await expectFail(() =>
    env.exchange.ingestHandoff({
      execution_id: id,
      lease_token: token,
      handoff: successHandoff({ execution_id: "EXEC-20260828-999" }),
    }),
  );
  await expectFail(() =>
    env.exchange.ingestHandoff({
      execution_id: id,
      lease_token: token,
      handoff: successHandoff({ task_id: "TASK-20260828-999" }),
    }),
  );
  await expectFail(() =>
    env.exchange.ingestHandoff({
      execution_id: id,
      lease_token: token,
      handoff: successHandoff({ mission_id: "MISSION-20260828-999" }),
    }),
  );
  await expectFail(() =>
    env.exchange.ingestHandoff({
      execution_id: id,
      lease_token: token,
      handoff: successHandoff({
        contract_hash: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      }),
    }),
  );
  await expectFail(() =>
    env.exchange.ingestHandoff({
      execution_id: id,
      lease_token: token,
      handoff: successHandoff({ base_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
    }),
  );
  await expectFail(() =>
    env.exchange.ingestHandoff({
      execution_id: id,
      lease_token: "0".repeat(32),
      handoff: successHandoff(),
    }),
  );

  let now = new Date("2026-08-28T22:00:00.000Z");
  const expiredEnv = tempEnv(() => now);
  const expired = await leaseReady(expiredEnv);
  now = new Date("2026-08-28T23:00:01.000Z");
  await expectFail(() =>
    expiredEnv.exchange.ingestHandoff({
      execution_id: expired.dispatched.execution.execution_id,
      lease_token: expired.dispatched.execution.lease_token,
      handoff: successHandoff(),
    }),
  );
  assert.equal(await env.exchange.getHandoff(id), null);
  assert.equal(await expiredEnv.exchange.getHandoff(expired.dispatched.execution.execution_id), null);
});

test("review/gate/verdict injection e stale binding → FAIL", async () => {
  const env = tempEnv();
  const { dispatched, task } = await leaseReady(env);
  const id = dispatched.execution.execution_id;
  const token = dispatched.execution.lease_token;

  await expectFail(() =>
    env.exchange.ingestHandoff({
      execution_id: id,
      lease_token: token,
      handoff: { ...successHandoff(), document_kind: "review_handoff" },
    }),
  );
  await expectFail(() =>
    env.exchange.ingestHandoff({
      execution_id: id,
      lease_token: token,
      handoff: { ...successHandoff(), document_kind: "human_approval_gate" },
    }),
  );
  await expectFail(() =>
    env.exchange.ingestHandoff({
      execution_id: id,
      lease_token: token,
      handoff: { ...successHandoff(), verdict: "APPROVED" },
    }),
  );

  const tampered = JSON.parse(JSON.stringify(task));
  tampered.acceptance_criteria = ["stale mutation after stamp"];
  assert.equal(verifyContractBinding(tampered).valid, false);
  await env.store.putTask(tampered);
  await expectFail(() =>
    env.exchange.ingestHandoff({
      execution_id: id,
      lease_token: token,
      handoff: successHandoff(),
    }),
  );
  assert.equal(await env.exchange.getHandoff(id), null);
});

test("path traversal → FAIL", async () => {
  const env = tempEnv();
  assert.throws(() => assertCanonicalId("EXEC", "../etc/passwd"));
  await assert.rejects(() => env.exchange.exportDispatchPackage({ execution_id: "../etc/passwd" }));
  await assert.rejects(() => env.exchange.getHandoff("EXEC-20260828-001/../../handoffs"));
  await assert.rejects(() =>
    env.exchange.ingestHandoff({
      execution_id: "../etc/passwd",
      lease_token: "x".repeat(16),
      handoff: successHandoff(),
    }),
  );
});

test("planted APPROVED não eleva authority; DataSource inclui handoff e cadeia continua invalid", async () => {
  const env = tempEnv();
  const { task, dispatched } = await leaseReady(env);
  const planted = stampContractHash({ ...task, state: "APPROVED" });
  await env.store.putTask(planted);
  const sourceBefore = new StoredControlPlaneDataSource({ store: env.store });
  const before = await sourceBefore.getTaskDetail(task.task_id);
  assert.equal(before.contractView.sufficientForAuthority, false);
  assert.equal(before.contractView.requiresLiveGithubApproval, true);
  assert.notEqual(before.contractView.approvalStatus, "approved");
  await expectFail(() =>
    env.exchange.ingestHandoff({
      execution_id: dispatched.execution.execution_id,
      lease_token: dispatched.execution.lease_token,
      handoff: successHandoff(),
    }),
  );

  const clean = tempEnv();
  const ok = await leaseReady(clean);
  await clean.exchange.ingestHandoff({
    execution_id: ok.dispatched.execution.execution_id,
    lease_token: ok.dispatched.execution.lease_token,
    handoff: successHandoff(),
  });
  const source = new StoredControlPlaneDataSource({ store: clean.store });
  const detail = await source.getTaskDetail(ok.task.task_id);
  assert.ok(detail.contractView.bundle.execution_handoff);
  assert.equal(detail.contractView.bundle.execution_handoff.outcome, "SUCCESS");
  assert.match(
    detail.contractView.handoffChain.find((step) => step.key === "execution_handoff").summary,
    /not review or human approval/i,
  );
  assert.equal(detail.contractView.chainConsistency, "invalid");
  assert.equal(detail.contractView.approvalStatus, "invalid");
  assert.equal(detail.contractView.sufficientForAuthority, false);
  assert.equal(detail.contractView.requiresLiveGithubApproval, true);
  assert.ok(detail.contractView.consistencyErrors.some((err) => err.includes("handoff chain missing")));
});

test("CLI export/ingest humano, sem imprimir lease_token", async () => {
  const env = tempEnv(() => new Date());
  const { dispatched } = await leaseReady(env);
  const exported = spawnSync(
    process.execPath,
    [CLI, "export", "--execution-id", dispatched.execution.execution_id, "--root", env.rootDir],
    { encoding: "utf8" },
  );
  assert.equal(exported.status, 0, exported.stderr);
  assert.equal(exported.stdout.includes(dispatched.execution.lease_token), false);
  const outbox = path.join(env.rootDir, "exchange", "outbox", `${dispatched.execution.execution_id}.json`);
  assert.equal(fs.existsSync(outbox), true);

  const handoffFile = path.join(env.rootDir, "incoming-handoff.json");
  fs.writeFileSync(handoffFile, `${JSON.stringify(successHandoff(), null, 2)}\n`);
  const ingested = spawnSync(
    process.execPath,
    [
      CLI,
      "ingest",
      "--execution-id",
      dispatched.execution.execution_id,
      "--lease-token",
      dispatched.execution.lease_token,
      "--file",
      handoffFile,
      "--root",
      env.rootDir,
    ],
    { encoding: "utf8" },
  );
  assert.equal(ingested.status, 0, ingested.stderr);
  assert.equal(ingested.stdout.includes(dispatched.execution.lease_token), false);
  const body = JSON.parse(ingested.stdout);
  assert.equal(body.state, "RESULT_SUBMITTED");
  assert.equal(body.task_state, "READY");
  assert.equal(body.authority_claim, "none");
});
