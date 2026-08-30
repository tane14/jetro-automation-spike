"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { JsonFileMissionTaskStore } = require("./JsonFileMissionTaskStore");
const { MissionTaskRuntime, RuntimeValidationError } = require("./MissionTaskRuntime");
const { TaskDispatchRuntime } = require("./TaskDispatchRuntime");
const { PreExecutionGateRuntime } = require("./PreExecutionGateRuntime");
const { GovernedExecutionRuntime } = require("./GovernedExecutionRuntime");
const { validateRunnerResult } = require("./RunnerResultValidator");

const BASE_SHA = "21f904c2ab693699940487b307c5f759f56927a5";
const HUMAN = "MACHUB";
const SYNTHETIC_CANARY = "SYNTHETIC_GOVERNED_CANARY_FIXTURE";
const SYNTHETIC_HASH = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function tempEnv() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "jetro-v14a-"));
  const store = new JsonFileMissionTaskStore({ rootDir });
  const clock = () => new Date("2026-08-30T22:00:00.000Z");
  const missions = new MissionTaskRuntime({ store, clock });
  const dispatch = new TaskDispatchRuntime({ store, clock });
  const gate = new PreExecutionGateRuntime({ store, clock });
  return { rootDir, store, missions, dispatch, gate, clock };
}

async function authorizedLease(env) {
  const mission = await env.missions.createMission({
    title: "v1.4A governed execution laboratory",
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

function orchestrator(env, runner) {
  return new GovernedExecutionRuntime({
    store: env.store,
    evaluateStartAuthorization: (id) => env.gate.evaluateStartAuthorization(id),
    runner,
    clock: env.clock,
  });
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

test("A. Gate denied → Runner call count 0", async () => {
  const env = tempEnv();
  const mission = await env.missions.createMission({
    title: "deny",
    base_sha: BASE_SHA,
    acceptance_criteria: ["x"],
  });
  const task = await env.missions.createTask({
    mission_id: mission.mission_id,
    acceptance_criteria: ["x"],
  });
  const dispatched = await env.dispatch.dispatchTask({ task_id: task.task_id });
  const runner = fakeRunner(fixtureRunnerResult({}));
  const runtime = orchestrator(env, runner);
  await assert.rejects(
    () =>
      runtime.runGovernedExecution({
        execution_id: dispatched.execution.execution_id,
        runnerRequest: requestFor(dispatched.task, dispatched.execution),
        validationExpectations: passingExpectations(),
      }),
    RuntimeValidationError,
  );
  assert.equal(runner.calls.length, 0);
});

test("B. Gate throws → Runner call count 0", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  const runner = fakeRunner(fixtureRunnerResult({}));
  const runtime = new GovernedExecutionRuntime({
    store: env.store,
    evaluateStartAuthorization: async () => {
      throw new Error("gate exploded");
    },
    runner,
    clock: env.clock,
  });
  await assert.rejects(
    () =>
      runtime.runGovernedExecution({
        execution_id: dispatched.execution.execution_id,
        runnerRequest: requestFor(task, dispatched.execution),
        validationExpectations: passingExpectations(),
      }),
    /gate exploded/,
  );
  assert.equal(runner.calls.length, 0);
});

test("C. allowed = 1 / 'true' / truthy object → Runner call count 0", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  for (const allowed of [1, "true", { ok: true }]) {
    const runner = fakeRunner(fixtureRunnerResult({}));
    const runtime = new GovernedExecutionRuntime({
      store: env.store,
      evaluateStartAuthorization: async () => ({ allowed, reasons: [] }),
      runner,
      clock: env.clock,
    });
    await assert.rejects(
      () =>
        runtime.runGovernedExecution({
          execution_id: dispatched.execution.execution_id,
          runnerRequest: requestFor(task, dispatched.execution),
          validationExpectations: passingExpectations(),
        }),
      RuntimeValidationError,
    );
    assert.equal(runner.calls.length, 0);
  }
});

test("D. LEASED → RUNNING occurs before Runner invocation", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  const seen = [];
  const runner = {
    calls: seen,
    async run(request) {
      const execution = await env.store.getExecution(request.executionId);
      const currentTask = await env.store.getTask(task.task_id);
      seen.push({ executionState: execution.state, taskState: currentTask.state });
      return fixtureRunnerResult({
        taskId: task.task_id,
        contractId: task.contract_id,
        executionId: dispatched.execution.execution_id,
      });
    },
  };
  const runtime = orchestrator(env, runner);
  await runtime.runGovernedExecution({
    execution_id: dispatched.execution.execution_id,
    runnerRequest: requestFor(task, dispatched.execution),
    validationExpectations: passingExpectations(),
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].executionState, "RUNNING");
  assert.equal(seen[0].taskState, "IN_PROGRESS");
});

test("E. RUNNING persistence failure → Runner call count 0", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  const original = env.store.putExecution.bind(env.store);
  env.store.putExecution = async (doc) => {
    if (doc && doc.state === "RUNNING") {
      throw new Error("persist RUNNING failed");
    }
    return original(doc);
  };
  const runner = fakeRunner(fixtureRunnerResult({}));
  const runtime = orchestrator(env, runner);
  await assert.rejects(
    () =>
      runtime.runGovernedExecution({
        execution_id: dispatched.execution.execution_id,
        runnerRequest: requestFor(task, dispatched.execution),
        validationExpectations: passingExpectations(),
      }),
    /persist RUNNING failed/,
  );
  assert.equal(runner.calls.length, 0);
  assert.equal((await env.store.getExecution(dispatched.execution.execution_id)).state, "LEASED");
});

test("F. Runner SUCCEEDED + validation PASS → Execution reviewable / Task REVIEW_READY", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  const result = fixtureRunnerResult({
    taskId: task.task_id,
    contractId: task.contract_id,
    executionId: dispatched.execution.execution_id,
  });
  const runtime = orchestrator(env, fakeRunner(result));
  const out = await runtime.runGovernedExecution({
    execution_id: dispatched.execution.execution_id,
    runnerRequest: requestFor(task, dispatched.execution),
    validationExpectations: passingExpectations(),
  });
  assert.equal(out.execution.state, "RESULT_SUBMITTED");
  assert.equal(out.task.state, "REVIEW_READY");
  assert.equal(out.validation.passed, true);
  assert.equal(out.taskCompletionAuthorized, false);
});

test("G. Runner SUCCEEDED + validation FAIL → NOT REVIEW_READY", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  const result = fixtureRunnerResult({
    taskId: task.task_id,
    contractId: task.contract_id,
    executionId: dispatched.execution.execution_id,
  });
  const runtime = orchestrator(env, fakeRunner(result));
  const out = await runtime.runGovernedExecution({
    execution_id: dispatched.execution.execution_id,
    runnerRequest: requestFor(task, dispatched.execution),
    validationExpectations: {
      ...passingExpectations(),
      expectedCanary: "THIS_CANARY_IS_ABSENT",
    },
  });
  assert.notEqual(out.task.state, "REVIEW_READY");
  assert.equal(out.execution.state, "FAILED");
  assert.equal(out.task.state, "FAILED");
  assert.equal(out.validation.passed, false);
});

test("H. exitCode=0 alone → NOT REVIEW_READY", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  const result = fixtureRunnerResult(
    {
      taskId: task.task_id,
      contractId: task.contract_id,
      executionId: dispatched.execution.execution_id,
    },
    {
      processExitCode: 0,
      structuredOutputValid: false,
      cliProtocolStatus: "INVALID_STRUCTURED_OUTPUT",
      resultClassification: "INVALID_STRUCTURED_OUTPUT",
    },
  );
  const runtime = orchestrator(env, fakeRunner(result));
  const out = await runtime.runGovernedExecution({
    execution_id: dispatched.execution.execution_id,
    runnerRequest: requestFor(task, dispatched.execution),
    validationExpectations: passingExpectations(),
  });
  assert.notEqual(out.task.state, "REVIEW_READY");
  assert.equal(out.execution.state, "FAILED");
});

test("I. Agent APPROVED/COMPLETED/MERGE text cannot cause REVIEW_READY without independent validation", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  const result = fixtureRunnerResult(
    {
      taskId: task.task_id,
      contractId: task.contract_id,
      executionId: dispatched.execution.execution_id,
    },
    { agentResult: "APPROVED COMPLETED MERGE FINAL_DECISION=BOUNDARY_VALIDATED" },
  );
  const runtime = orchestrator(env, fakeRunner(result));
  const out = await runtime.runGovernedExecution({
    execution_id: dispatched.execution.execution_id,
    runnerRequest: requestFor(task, dispatched.execution),
    validationExpectations: passingExpectations(),
  });
  assert.notEqual(out.task.state, "REVIEW_READY");
  assert.equal(out.execution.state, "FAILED");
});

test("J. Agent output can NEVER set Task COMPLETED / APPROVED / MERGED", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  const result = fixtureRunnerResult(
    {
      taskId: task.task_id,
      contractId: task.contract_id,
      executionId: dispatched.execution.execution_id,
    },
    { agentResult: `COMPLETED ${SYNTHETIC_CANARY}` },
  );
  const runtime = orchestrator(env, fakeRunner(result));
  const out = await runtime.runGovernedExecution({
    execution_id: dispatched.execution.execution_id,
    runnerRequest: requestFor(task, dispatched.execution),
    validationExpectations: passingExpectations(),
  });
  assert.equal(out.task.state, "REVIEW_READY");
  assert.notEqual(out.task.state, "APPROVED");
  assert.notEqual(out.task.state, "MERGE_READY");
  assert.notEqual(out.task.state, "MERGED");
  assert.equal(out.taskCompletionAuthorized, false);
});

test("K. Evidence record cannot authorize Task completion", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  const result = fixtureRunnerResult({
    taskId: task.task_id,
    contractId: task.contract_id,
    executionId: dispatched.execution.execution_id,
  });
  const runtime = orchestrator(env, fakeRunner(result));
  const out = await runtime.runGovernedExecution({
    execution_id: dispatched.execution.execution_id,
    runnerRequest: requestFor(task, dispatched.execution),
    validationExpectations: passingExpectations(),
  });
  assert.equal(out.evidence.evidenceAuthority, false);
  assert.equal(out.evidence.taskCompletionAuthorized, false);
  assert.equal(out.task.state, "REVIEW_READY");
  assert.notEqual(out.task.state, "APPROVED");
});

test("L. RunnerResult.lifecycleAdvanced=true → validation FAIL", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  const result = fixtureRunnerResult(
    {
      taskId: task.task_id,
      contractId: task.contract_id,
      executionId: dispatched.execution.execution_id,
    },
    { lifecycleAdvanced: true },
  );
  const runtime = orchestrator(env, fakeRunner(result));
  const out = await runtime.runGovernedExecution({
    execution_id: dispatched.execution.execution_id,
    runnerRequest: requestFor(task, dispatched.execution),
    validationExpectations: passingExpectations(),
  });
  assert.equal(out.validation.passed, false);
  assert.notEqual(out.task.state, "REVIEW_READY");
});

test("M. RunnerResult.taskCompletionAuthorized=true → validation FAIL", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  const result = fixtureRunnerResult(
    {
      taskId: task.task_id,
      contractId: task.contract_id,
      executionId: dispatched.execution.execution_id,
    },
    { taskCompletionAuthorized: true },
  );
  const runtime = orchestrator(env, fakeRunner(result));
  const out = await runtime.runGovernedExecution({
    execution_id: dispatched.execution.execution_id,
    runnerRequest: requestFor(task, dispatched.execution),
    validationExpectations: passingExpectations(),
  });
  assert.equal(out.validation.passed, false);
  assert.notEqual(out.task.state, "REVIEW_READY");
});

test("N. automatic retry = 0", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  const runner = fakeRunner(
    fixtureRunnerResult({
      taskId: task.task_id,
      contractId: task.contract_id,
      executionId: dispatched.execution.execution_id,
    }),
  );
  const runtime = orchestrator(env, runner);
  const out = await runtime.runGovernedExecution({
    execution_id: dispatched.execution.execution_id,
    runnerRequest: requestFor(task, dispatched.execution),
    validationExpectations: passingExpectations(),
  });
  assert.equal(runner.calls.length, 1);
  assert.equal(out.evidence.retryCount, 0);
});

test("O. second Runner invocation for the same envelope is blocked", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  const runner = fakeRunner(
    fixtureRunnerResult({
      taskId: task.task_id,
      contractId: task.contract_id,
      executionId: dispatched.execution.execution_id,
    }),
  );
  const runtime = orchestrator(env, runner);
  const input = {
    execution_id: dispatched.execution.execution_id,
    runnerRequest: requestFor(task, dispatched.execution),
    validationExpectations: passingExpectations(),
  };
  await runtime.runGovernedExecution(input);
  await assert.rejects(() => runtime.runGovernedExecution(input), /already started/);
  assert.equal(runner.calls.length, 1);
});

test("MVP-02 fixture: LEASED → RUNNING → REVIEW_READY, Task not completed", async () => {
  const env = tempEnv();
  const { task, dispatched } = await authorizedLease(env);
  const readyPkg = await env.store.getPackage(dispatched.execution.execution_id);
  const authorizedTask = await env.store.getTask(task.task_id);
  assert.notEqual(readyPkg.task_contract_hash, authorizedTask.contract_hash);

  const result = fixtureRunnerResult({
    taskId: task.task_id,
    contractId: task.contract_id,
    executionId: dispatched.execution.execution_id,
  });
  const runtime = orchestrator(env, fakeRunner(result));
  const out = await runtime.runGovernedExecution({
    execution_id: dispatched.execution.execution_id,
    runnerRequest: requestFor(task, dispatched.execution),
    validationExpectations: passingExpectations(),
  });
  assert.equal(out.execution.state, "RESULT_SUBMITTED");
  assert.equal(out.task.state, "REVIEW_READY");
  assert.notEqual(out.task.state, "APPROVED");
  assert.equal(out.taskCompletionAuthorized, false);
  assert.equal(out.provenance.pre_authorization_contract_hash, readyPkg.task_contract_hash);
  assert.equal(out.provenance.authorized_contract_hash, authorizedTask.contract_hash);
  assert.equal(out.evidence.evidenceAuthority, false);
});

test("exit 0 is not sufficient by itself (validator unit)", () => {
  const result = {
    timedOut: false,
    spawnAttempts: 1,
    processExitCode: 0,
    structuredOutputValid: false,
    cliProtocolStatus: "INVALID_STRUCTURED_OUTPUT",
    resultClassification: "INVALID_STRUCTURED_OUTPUT",
    lifecycleAdvanced: false,
    taskCompletionAuthorized: false,
    securityBoundary: false,
  };
  const validation = validateRunnerResult(result, passingExpectations());
  assert.equal(validation.passed, false);
});
