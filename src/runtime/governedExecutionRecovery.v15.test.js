"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { stampContractHash, verifyContractBinding } = require("../contracts");
const { JsonFileMissionTaskStore } = require("./JsonFileMissionTaskStore");
const { MissionTaskRuntime, RuntimeValidationError } = require("./MissionTaskRuntime");
const { TaskDispatchRuntime } = require("./TaskDispatchRuntime");
const { PreExecutionGateRuntime } = require("./PreExecutionGateRuntime");
const { GovernedExecutionRuntime, MemoryEvidenceSink } = require("./GovernedExecutionRuntime");
const { GovernedExecutionLifecycleRuntime } = require("./GovernedExecutionLifecycleRuntime");
const {
  GovernedExecutionRecovery,
  CLASSIFICATION,
} = require("./GovernedExecutionRecovery");

const BASE_SHA = "21f904c2ab693699940487b307c5f759f56927a5";
const HUMAN = "MACHUB";
const SYNTHETIC_CANARY = "SYNTHETIC_GOVERNED_CANARY_FIXTURE";
const SYNTHETIC_HASH = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function tempEnv(clockFn) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "jetro-v15-"));
  const store = new JsonFileMissionTaskStore({ rootDir });
  const clock =
    typeof clockFn === "function" ? clockFn : () => new Date("2026-08-30T22:00:00.000Z");
  const missions = new MissionTaskRuntime({ store, clock });
  const dispatch = new TaskDispatchRuntime({ store, clock });
  const gate = new PreExecutionGateRuntime({ store, clock });
  return { rootDir, store, missions, dispatch, gate, clock };
}

async function authorizedLease(env) {
  const mission = await env.missions.createMission({
    title: "v1.5 governed execution recovery laboratory",
    base_sha: BASE_SHA,
    acceptance_criteria: ["REVIEW_READY is not completion"],
  });
  const task = await env.missions.createTask({
    mission_id: mission.mission_id,
    acceptance_criteria: ["Agent text is not authority"],
  });
  const dispatched = await env.dispatch.dispatchTask({ task_id: task.task_id });
  await env.gate.authorizeExecution({
    execution_id: dispatched.execution.execution_id,
    acknowledged_by: HUMAN,
  });
  return { mission, task: await env.store.getTask(task.task_id), dispatched };
}

function fixtureRunnerResult(ids, overrides = {}) {
  return {
    runId: "RUN-MVP-02A-001",
    taskId: ids.taskId,
    contractId: ids.contractId,
    executionId: ids.executionId,
    processExitCode: 0,
    timedOut: false,
    spawnAttempts: 1,
    resultClassification: "SUCCEEDED",
    structuredOutputValid: true,
    cliProtocolStatus: "SUCCEEDED",
    lifecycleAdvanced: false,
    taskCompletionAuthorized: false,
    securityBoundary: false,
    riskTier: "T1",
    environment: "LAB_ONLY",
    agentResult: `workspace read ${SYNTHETIC_CANARY}`,
    promptHash: SYNTHETIC_HASH,
    stdoutHash: SYNTHETIC_HASH,
    stderrHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    processId: 7,
    startedAt: "2026-08-30T22:00:01Z",
    finishedAt: "2026-08-30T22:00:14Z",
    durationMs: 13000,
    workspacePath: "C:\\JETRORunnerLab\\FIXTURE01",
    commandIdentity: {
      file: "C:\\Users\\lab\\cursor-agent\\agent.cmd",
      resolvedFile: "C:\\Users\\lab\\cursor-agent\\versions\\fixture\\node.exe",
      args: ["--print", "--output-format", "json", "--mode", "ask", "--workspace", "<ws>", "--trust", "--", "<prompt>"],
    },
    cliVersion: "2026.08.25-3e8eec8",
    ...overrides,
  };
}

function passingExpectations() {
  return {
    expectedCanary: SYNTHETIC_CANARY,
    inputShaBefore: SYNTHETIC_HASH,
    inputShaAfter: SYNTHETIC_HASH,
    workspaceIntegrityOk: true,
    repositoryIntegrityOk: true,
    acceptableExitCodes: [0],
  };
}

function fakeRunner(resultOrFn) {
  const calls = [];
  return {
    calls,
    async run(request) {
      calls.push(request);
      if (typeof resultOrFn === "function") {
        return resultOrFn(request);
      }
      return resultOrFn;
    },
  };
}

function recoveryOf(env, runner, extra = {}) {
  return new GovernedExecutionRecovery({
    store: env.store,
    evaluateStartAuthorization: (id) => env.gate.evaluateStartAuthorization(id),
    runner,
    clock: env.clock,
    ...extra,
  });
}

async function persistExecutionRunningPartial(env, executionId) {
  const execution = await env.store.getExecution(executionId);
  execution.state = "RUNNING";
  execution.heartbeat_at = "2026-08-30T22:00:00Z";
  execution.authority_claim = "none";
  await env.store.putExecution(execution);
  return env.store.getExecution(executionId);
}

async function persistTaskState(env, taskId, state) {
  const current = await env.store.getTask(taskId);
  current.state = state;
  delete current.contract_hash;
  const stamped = stampContractHash(current);
  await env.store.putTask(stamped);
  return env.store.getTask(taskId);
}

async function persistResultSubmittedPartial(env, executionId) {
  const execution = await env.store.getExecution(executionId);
  execution.state = "RESULT_SUBMITTED";
  execution.outcome = "SUCCESS";
  execution.heartbeat_at = "2026-08-30T22:00:14Z";
  delete execution.lease_token;
  delete execution.leased_at;
  delete execution.lease_ttl_seconds;
  execution.authority_claim = "none";
  await env.store.putExecution(execution);
  return env.store.getExecution(executionId);
}

function requestFor(task, execution) {
  return {
    runId: "RUN-MVP-02A-001",
    taskId: task.task_id,
    contractId: task.contract_id,
    executionId: execution.execution_id,
    workspacePath: "C:\\JETRORunnerLab\\FIXTURE01",
    prompt: "fixture prompt",
    timeoutMs: 180000,
    trustAuthorization: { authorized: true, workspacePath: "C:\\JETRORunnerLab\\FIXTURE01" },
  };
}

test("01 consistent envelope => no-op PASS", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  const sink = new MemoryEvidenceSink();
  const runner = fakeRunner(
    fixtureRunnerResult({
      taskId: task.task_id,
      contractId: task.contract_id,
      executionId: dispatched.execution.execution_id,
    }),
  );
  const orchestrated = new GovernedExecutionRuntime({
    store: env.store,
    evaluateStartAuthorization: (id) => env.gate.evaluateStartAuthorization(id),
    runner,
    clock: env.clock,
    evidenceSink: sink,
  });
  await orchestrated.runGovernedExecution({
    execution_id: dispatched.execution.execution_id,
    runnerRequest: requestFor(task, dispatched.execution),
    validationExpectations: passingExpectations(),
  });
  const beforeTask = await env.store.getTask(task.task_id);
  const beforeExec = await env.store.getExecution(dispatched.execution.execution_id);
  const recoveryRunner = fakeRunner({});
  const recovery = recoveryOf(env, recoveryRunner, { evidenceSink: sink });
  const out = await recovery.recoverGovernedExecution({
    execution_id: dispatched.execution.execution_id,
    force: true,
    allowed: true,
    passed: true,
    recover: true,
  });
  assert.equal(out.classification, CLASSIFICATION.CONSISTENT);
  assert.equal(out.outcome, "PASS");
  assert.equal(out.runner_invoked, false);
  assert.equal(out.authority_claim, "none");
  assert.equal(out.taskCompletionAuthorized, false);
  assert.equal(recoveryRunner.calls.length, 0);
  assert.equal((await env.store.getTask(task.task_id)).state, beforeTask.state);
  assert.equal((await env.store.getExecution(dispatched.execution.execution_id)).state, beforeExec.state);
  assert.ok(out.decision_reasons.some((reason) => /ignored non-authoritative caller flags/.test(reason)));
});

test("02 R1 partial start => Task IN_PROGRESS, runner count 0", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  await persistExecutionRunningPartial(env, dispatched.execution.execution_id);
  const runner = fakeRunner({});
  const recovery = recoveryOf(env, runner);
  const out = await recovery.recoverGovernedExecution({
    execution_id: dispatched.execution.execution_id,
  });
  assert.equal(out.classification, CLASSIFICATION.RECOVERABLE_START_PARTIAL);
  assert.equal(out.outcome, "PASS");
  assert.equal((await env.store.getTask(task.task_id)).state, "IN_PROGRESS");
  assert.equal((await env.store.getExecution(dispatched.execution.execution_id)).state, "RUNNING");
  assert.equal(out.runner_invoked, false);
  assert.equal(runner.calls.length, 0);
  assert.equal(out.taskCompletionAuthorized, false);
  const transitions = await env.store.listTransitions(dispatched.execution.execution_id);
  assert.ok(transitions.some((item) => item.suffix === "AUTHORIZED-IN_PROGRESS"));
});

test("03 R1 repeated recovery => idempotent no-op", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  await persistExecutionRunningPartial(env, dispatched.execution.execution_id);
  const runner = fakeRunner({});
  const recovery = recoveryOf(env, runner);
  const first = await recovery.recoverGovernedExecution({
    execution_id: dispatched.execution.execution_id,
  });
  const second = await recovery.recoverGovernedExecution({
    execution_id: dispatched.execution.execution_id,
  });
  assert.equal(first.classification, CLASSIFICATION.RECOVERABLE_START_PARTIAL);
  assert.equal(second.classification, CLASSIFICATION.CONSISTENT);
  assert.equal(second.recovery_id, first.recovery_id);
  assert.equal((await env.store.getTask(task.task_id)).state, "IN_PROGRESS");
  assert.equal(runner.calls.length, 0);
  const transitions = await env.store.listTransitions(dispatched.execution.execution_id);
  const startTaskTransitions = transitions.filter((item) => item.suffix === "AUTHORIZED-IN_PROGRESS");
  assert.equal(startTaskTransitions.length, 1);
});

test("04 R2 inverse partial => BLOCKED / FAIL-CLOSED", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  await persistTaskState(env, task.task_id, "IN_PROGRESS");
  const runner = fakeRunner({});
  const recovery = recoveryOf(env, runner);
  const out = await recovery.recoverGovernedExecution({
    execution_id: dispatched.execution.execution_id,
    allowed: true,
    force: true,
  });
  assert.equal(out.outcome, "BLOCKED");
  assert.ok(
    out.classification === CLASSIFICATION.UNRECOVERABLE ||
      out.classification === CLASSIFICATION.STALE_LEASE,
  );
  assert.equal((await env.store.getExecution(dispatched.execution.execution_id)).state, "LEASED");
  assert.equal((await env.store.getTask(task.task_id)).state, "IN_PROGRESS");
  assert.equal(runner.calls.length, 0);
  assert.equal(out.runner_invoked, false);
});

test("05 R3 partial result => Task REVIEW_READY, no runner replay", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  const lifecycle = new GovernedExecutionLifecycleRuntime({
    store: env.store,
    clock: env.clock,
    evaluateStartAuthorization: (id) => env.gate.evaluateStartAuthorization(id),
  });
  await lifecycle.markExecutionRunning({ execution_id: dispatched.execution.execution_id });
  const currentTask = await env.store.getTask(task.task_id);
  const result = fixtureRunnerResult({
    taskId: currentTask.task_id,
    contractId: currentTask.contract_id,
    executionId: dispatched.execution.execution_id,
  });
  await env.store.putRunnerAttempt(dispatched.execution.execution_id, {
    schema_version: "1.5-governed-runner-attempt",
    document_kind: "runner_attempt",
    attempt_id: `ATTEMPT-${dispatched.execution.execution_id}`,
    execution_id: dispatched.execution.execution_id,
    task_id: currentTask.task_id,
    contract_id: currentTask.contract_id,
    contract_hash: currentTask.contract_hash,
    invocation_state: "RETURNED",
    runner_result: result,
    authority_claim: "none",
  });
  await persistResultSubmittedPartial(env, dispatched.execution.execution_id);
  const runner = fakeRunner({});
  const recovery = recoveryOf(env, runner);
  const out = await recovery.recoverGovernedExecution({
    execution_id: dispatched.execution.execution_id,
    validationExpectations: passingExpectations(),
  });
  assert.equal(out.classification, CLASSIFICATION.RECOVERABLE_RESULT_PARTIAL);
  assert.equal(out.outcome, "PASS");
  assert.equal((await env.store.getTask(task.task_id)).state, "REVIEW_READY");
  assert.notEqual((await env.store.getTask(task.task_id)).state, "COMPLETED");
  assert.equal((await env.store.getExecution(dispatched.execution.execution_id)).state, "RESULT_SUBMITTED");
  assert.equal(runner.calls.length, 0);
  assert.equal(out.runner_invoked, false);
});

test("06 R4 evidence missing => regenerate evidence only", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  const sink = new MemoryEvidenceSink();
  const runner = fakeRunner(
    fixtureRunnerResult({
      taskId: task.task_id,
      contractId: task.contract_id,
      executionId: dispatched.execution.execution_id,
    }),
  );
  const orchestrated = new GovernedExecutionRuntime({
    store: env.store,
    evaluateStartAuthorization: (id) => env.gate.evaluateStartAuthorization(id),
    runner,
    clock: env.clock,
    evidenceSink: {
      async putEvidence() {
        throw new Error("evidence sink failed");
      },
      async listEvidenceIds() {
        return [];
      },
      async listEvidence() {
        return [];
      },
    },
  });
  await assert.rejects(
    () =>
      orchestrated.runGovernedExecution({
        execution_id: dispatched.execution.execution_id,
        runnerRequest: requestFor(task, dispatched.execution),
        validationExpectations: passingExpectations(),
      }),
    /evidence persistence failed after lifecycle persist/,
  );
  assert.equal((await env.store.getTask(task.task_id)).state, "REVIEW_READY");
  assert.equal((await env.store.getExecution(dispatched.execution.execution_id)).state, "RESULT_SUBMITTED");
  const recoveryRunner = fakeRunner({});
  const recovery = recoveryOf(env, recoveryRunner, { evidenceSink: sink });
  const out = await recovery.recoverGovernedExecution({
    execution_id: dispatched.execution.execution_id,
  });
  assert.equal(out.classification, CLASSIFICATION.RECOVERABLE_EVIDENCE_MISSING);
  assert.equal(out.outcome, "PASS");
  assert.equal((await env.store.getTask(task.task_id)).state, "REVIEW_READY");
  assert.equal((await env.store.getExecution(dispatched.execution.execution_id)).state, "RESULT_SUBMITTED");
  assert.equal(recoveryRunner.calls.length, 0);
  assert.equal(sink.records.some((item) => item.record_kind === "governed_run_evidence_data"), true);
  assert.equal(sink.records.find((item) => item.record_kind === "governed_run_evidence_data").evidenceAuthority, false);
});

test("07 R5 unknown runner invocation => AMBIGUOUS_RUNNER_INVOCATION BLOCKED", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  await persistExecutionRunningPartial(env, dispatched.execution.execution_id);
  await persistTaskState(env, task.task_id, "IN_PROGRESS");
  await env.store.putRunnerAttempt(dispatched.execution.execution_id, {
    schema_version: "1.5-governed-runner-attempt",
    document_kind: "runner_attempt",
    attempt_id: `ATTEMPT-${dispatched.execution.execution_id}`,
    execution_id: dispatched.execution.execution_id,
    task_id: task.task_id,
    contract_id: task.contract_id,
    contract_hash: (await env.store.getTask(task.task_id)).contract_hash,
    invocation_state: "UNKNOWN",
    runner_result: null,
    authority_claim: "none",
  });
  const runner = fakeRunner({});
  const recovery = recoveryOf(env, runner);
  const out = await recovery.recoverGovernedExecution({
    execution_id: dispatched.execution.execution_id,
  });
  assert.equal(out.classification, CLASSIFICATION.AMBIGUOUS_RUNNER_INVOCATION);
  assert.equal(out.outcome, "BLOCKED");
  assert.equal(runner.calls.length, 0);
  assert.equal(out.runner_invoked, false);
  assert.equal((await env.store.getExecution(dispatched.execution.execution_id)).state, "RUNNING");
  assert.equal((await env.store.getTask(task.task_id)).state, "IN_PROGRESS");
});

test("08 contract hash mismatch => BLOCKED", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  await persistExecutionRunningPartial(env, dispatched.execution.execution_id);
  const current = await env.store.getTask(task.task_id);
  current.contract_hash = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  await env.store.putTask(current);
  assert.equal(verifyContractBinding(await env.store.getTask(task.task_id)).valid, false);
  const runner = fakeRunner({});
  const recovery = recoveryOf(env, runner);
  const out = await recovery.recoverGovernedExecution({
    execution_id: dispatched.execution.execution_id,
  });
  assert.equal(out.classification, CLASSIFICATION.CORRUPT_BINDING);
  assert.equal(out.outcome, "BLOCKED");
  assert.equal((await env.store.getTask(task.task_id)).state, "AUTHORIZED");
  assert.equal(runner.calls.length, 0);
});

test("09 correlation mismatch => BLOCKED", async () => {
  const env = tempEnv();
  const { dispatched } = await authorizedLease(env);
  await persistExecutionRunningPartial(env, dispatched.execution.execution_id);
  const execution = await env.store.getExecution(dispatched.execution.execution_id);
  execution.contract_id = "CONTRACT-20260830-999";
  await env.store.putExecution(execution);
  const runner = fakeRunner({});
  const recovery = recoveryOf(env, runner);
  const out = await recovery.recoverGovernedExecution({
    execution_id: dispatched.execution.execution_id,
  });
  assert.equal(out.outcome, "BLOCKED");
  assert.equal(out.classification, CLASSIFICATION.CORRUPT_BINDING);
  assert.ok(out.decision_reasons.some((reason) => /contract ID mismatch|correlation mismatch/.test(reason)));
  assert.equal(runner.calls.length, 0);
});

test("10 stale authorization / lease where required => BLOCKED", async () => {
  let now = new Date("2026-08-30T22:00:00.000Z");
  const env = tempEnv(() => now);
  const { task, dispatched } = await authorizedLease(env);
  await persistTaskState(env, task.task_id, "IN_PROGRESS");
  now = new Date("2026-08-30T23:00:01.000Z");
  const runner = fakeRunner({});
  const recovery = recoveryOf(env, runner);
  const out = await recovery.recoverGovernedExecution({
    execution_id: dispatched.execution.execution_id,
  });
  assert.equal(out.classification, CLASSIFICATION.STALE_LEASE);
  assert.equal(out.outcome, "BLOCKED");
  assert.equal((await env.store.getExecution(dispatched.execution.execution_id)).state, "LEASED");
  assert.equal(runner.calls.length, 0);
});

test("11 transition already present => no duplicate transition", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  await persistExecutionRunningPartial(env, dispatched.execution.execution_id);
  const recovery = recoveryOf(env, fakeRunner({}));
  await recovery.recoverGovernedExecution({ execution_id: dispatched.execution.execution_id });
  const before = await env.store.listTransitions(dispatched.execution.execution_id);
  await recovery.recoverGovernedExecution({ execution_id: dispatched.execution.execution_id });
  const after = await env.store.listTransitions(dispatched.execution.execution_id);
  assert.equal(after.length, before.length);
  assert.equal(
    after.filter((item) => item.suffix === "AUTHORIZED-IN_PROGRESS").length,
    1,
  );
  assert.equal((await env.store.getTask(task.task_id)).state, "IN_PROGRESS");
});

test("12 injected persistence failure => explicit failure, no false success", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  await persistExecutionRunningPartial(env, dispatched.execution.execution_id);
  const original = env.store.putTask.bind(env.store);
  env.store.putTask = async (doc) => {
    if (doc && doc.state === "IN_PROGRESS") {
      throw new Error("persist IN_PROGRESS failed");
    }
    return original(doc);
  };
  const recovery = recoveryOf(env, fakeRunner({}));
  await assert.rejects(
    () => recovery.recoverGovernedExecution({ execution_id: dispatched.execution.execution_id }),
    /recovery persistence failed/,
  );
  assert.equal((await env.store.getTask(task.task_id)).state, "AUTHORIZED");
  assert.equal((await env.store.getExecution(dispatched.execution.execution_id)).state, "RUNNING");
});

test("13 R1 still recovers after lease TTL expiry because RUNNING is already persisted", async () => {
  let now = new Date("2026-08-30T22:00:00.000Z");
  const env = tempEnv(() => now);
  const { task, dispatched } = await authorizedLease(env);
  await persistExecutionRunningPartial(env, dispatched.execution.execution_id);
  now = new Date("2026-08-30T23:00:01.000Z");
  const runner = fakeRunner({});
  const recovery = recoveryOf(env, runner);
  const out = await recovery.recoverGovernedExecution({
    execution_id: dispatched.execution.execution_id,
  });
  assert.equal(out.classification, CLASSIFICATION.RECOVERABLE_START_PARTIAL);
  assert.equal((await env.store.getTask(task.task_id)).state, "IN_PROGRESS");
  assert.equal(runner.calls.length, 0);
});

test("14 recovery never transitions Task to COMPLETED", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  await persistExecutionRunningPartial(env, dispatched.execution.execution_id);
  const recovery = recoveryOf(env, fakeRunner({}));
  const out = await recovery.recoverGovernedExecution({
    execution_id: dispatched.execution.execution_id,
    to_state: "COMPLETED",
  });
  assert.notEqual((await env.store.getTask(task.task_id)).state, "COMPLETED");
  assert.notEqual(out.persisted_state_after.task_state, "COMPLETED");
  assert.equal(out.taskCompletionAuthorized, false);
});

test("15 malformed runner attempt with start-partial contradiction is fail-closed", async () => {
  const env = tempEnv();
  const { dispatched } = await authorizedLease(env);
  await persistExecutionRunningPartial(env, dispatched.execution.execution_id);
  await env.store.putRunnerAttempt(dispatched.execution.execution_id, {
    schema_version: "1.5-governed-runner-attempt",
    document_kind: "runner_attempt",
    attempt_id: `ATTEMPT-${dispatched.execution.execution_id}`,
    execution_id: dispatched.execution.execution_id,
    invocation_state: "INVOKED",
    runner_result: null,
    authority_claim: "none",
  });
  const runner = fakeRunner({});
  const out = await recoveryOf(env, runner).recoverGovernedExecution({
    execution_id: dispatched.execution.execution_id,
  });
  assert.equal(out.classification, CLASSIFICATION.AMBIGUOUS_RUNNER_INVOCATION);
  assert.equal(out.outcome, "BLOCKED");
  assert.equal(runner.calls.length, 0);
});

test("16 normal governed path persists runner attempt identity before invocation", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  let attemptDuringRun = null;
  const runner = {
    calls: [],
    async run(request) {
      attemptDuringRun = await env.store.getRunnerAttempt(request.executionId);
      this.calls.push(request);
      return fixtureRunnerResult({
        taskId: task.task_id,
        contractId: task.contract_id,
        executionId: dispatched.execution.execution_id,
      });
    },
  };
  const orchestrated = new GovernedExecutionRuntime({
    store: env.store,
    evaluateStartAuthorization: (id) => env.gate.evaluateStartAuthorization(id),
    runner,
    clock: env.clock,
  });
  await orchestrated.runGovernedExecution({
    execution_id: dispatched.execution.execution_id,
    runnerRequest: requestFor(task, dispatched.execution),
    validationExpectations: passingExpectations(),
  });
  assert.equal(attemptDuringRun.invocation_state, "INVOKED");
  assert.equal(attemptDuringRun.attempt_id, `ATTEMPT-${dispatched.execution.execution_id}`);
  const after = await env.store.getRunnerAttempt(dispatched.execution.execution_id);
  assert.equal(after.invocation_state, "RETURNED");
  assert.equal(runner.calls.length, 1);
});
