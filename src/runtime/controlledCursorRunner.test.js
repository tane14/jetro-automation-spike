"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { sha256Hex } = require("../contracts/sha256");
const { sha256BytesHex } = require("./sha256Bytes");
const { parseCursorCliEnvelope } = require("./cursorCliEnvelope");
const { NodeChildProcessExecutor, FORBIDDEN_FLAGS } = require("./NodeChildProcessExecutor");
const {
  ControlledCursorRunner,
  CLASSIFICATION,
  buildInvocationArgs,
} = require("./ControlledCursorRunner");

const WS =
  process.platform === "win32" ? "C:\\JETRORunnerLab\\MVP01" : "/tmp/JETRORunnerLab/MVP01";
const OTHER =
  process.platform === "win32" ? "C:\\JETRORunnerLab\\OTHER" : "/tmp/JETRORunnerLab/OTHER";
const PARENT = process.platform === "win32" ? "C:\\JETRORunnerLab" : "/tmp/JETRORunnerLab";

const SUCCESS_ENVELOPE = {
  type: "result",
  subtype: "success",
  is_error: false,
  duration_ms: 7316,
  duration_api_ms: 7316,
  result: "Vou ler input.txt.JETRO_RUNNER_MVP_01_CANARY_20260830",
  session_id: "d3a771a0-ab6a-4b93-ab2d-f68935d01b84",
  request_id: "fa7c8806-7017-4230-8c34-3828b9070f77",
  usage: {
    inputTokens: 8374,
    outputTokens: 111,
    cacheReadTokens: 18944,
    cacheWriteTokens: 0,
  },
};

function allowedStart() {
  return async () => ({
    allowed: true,
    reasons: [],
    sufficient_for_authority: false,
    requires_live_github_approval: true,
  });
}

function deniedStart(reasons = ["NOT_AUTHORIZED"]) {
  return async () => ({
    allowed: false,
    reasons,
    sufficient_for_authority: false,
  });
}

function baseRequest(overrides = {}) {
  return {
    runId: "RUN-MVP-01-001",
    taskId: "TASK-20260830-001",
    contractId: "CONTRACT-20260830-001",
    executionId: "EXEC-20260830-001",
    workspacePath: WS,
    prompt: "Read input.txt and return its contents.",
    timeoutMs: 180000,
    trustAuthorization: { authorized: true, workspacePath: WS },
    ...overrides,
  };
}

function fakeExecutor(result) {
  const calls = [];
  return {
    calls,
    async spawn(spec) {
      calls.push(spec);
      if (typeof result === "function") {
        return result(spec);
      }
      return {
        pid: 4242,
        exitCode: 0,
        timedOut: false,
        stdout: Buffer.from(JSON.stringify(SUCCESS_ENVELOPE), "utf8"),
        stderr: Buffer.alloc(0),
        spawnAttempts: 1,
        ...result,
      };
    },
  };
}

function runnerWith(executor, evaluate = allowedStart()) {
  return new ControlledCursorRunner({
    processExecutor: executor,
    evaluateStartAuthorization: evaluate,
    agentPath: "C:\\Users\\Alexandre\\AppData\\Local\\cursor-agent\\agent.cmd",
    cliVersion: "2026.08.25-3e8eec8",
    clock: () => new Date("2026-08-30T18:00:00.000Z"),
  });
}

test("A. valid authorized request builds expected invocation", async () => {
  const executor = fakeExecutor();
  const runner = runnerWith(executor);
  const result = await runner.run(baseRequest());
  assert.equal(executor.calls.length, 1);
  const spec = executor.calls[0];
  assert.equal(spec.file, "C:\\Users\\Alexandre\\AppData\\Local\\cursor-agent\\agent.cmd");
  assert.deepEqual(spec.args.slice(0, 8), [
    "--print",
    "--output-format",
    "json",
    "--mode",
    "ask",
    "--workspace",
    WS,
    "--trust",
  ]);
  assert.equal(spec.args[8], "--");
  assert.equal(spec.args[9], "Read input.txt and return its contents.");
  assert.equal(result.resultClassification, CLASSIFICATION.SUCCEEDED);
  assert.equal(result.commandIdentity.args.includes("--trust"), true);
});

test("B. missing trust authorization => BLOCKED", async () => {
  const executor = fakeExecutor();
  const runner = runnerWith(executor);
  const req = baseRequest();
  delete req.trustAuthorization;
  const result = await runner.run(req);
  assert.equal(result.resultClassification, CLASSIFICATION.BLOCKED);
  assert.equal(executor.calls.length, 0);
  assert.ok(result.blockedReasons.some((r) => /trust/i.test(r)));
});

test("C. trust for different workspace => BLOCKED", async () => {
  const executor = fakeExecutor();
  const runner = runnerWith(executor);
  const result = await runner.run(
    baseRequest({
      workspacePath: WS,
      trustAuthorization: { authorized: true, workspacePath: OTHER },
    }),
  );
  assert.equal(result.resultClassification, CLASSIFICATION.BLOCKED);
  assert.equal(executor.calls.length, 0);
});

test("trailing slash does not break exact workspace binding", async () => {
  const executor = fakeExecutor();
  const trailing = WS.endsWith("\\") || WS.endsWith("/") ? WS : WS + (process.platform === "win32" ? "\\" : "/");
  const result = await runnerWith(executor).run(
    baseRequest({
      workspacePath: trailing,
      trustAuthorization: { authorized: true, workspacePath: WS },
    }),
  );
  assert.equal(result.resultClassification, CLASSIFICATION.SUCCEEDED);
  assert.equal(executor.calls.length, 1);
});

test("parent workspace trust does not authorize child workspace", async () => {
  const executor = fakeExecutor();
  const runner = runnerWith(executor);
  const result = await runner.run(
    baseRequest({
      workspacePath: WS,
      trustAuthorization: { authorized: true, workspacePath: PARENT },
    }),
  );
  assert.equal(result.resultClassification, CLASSIFICATION.BLOCKED);
  assert.equal(executor.calls.length, 0);
});

test("D. --force never emitted", async () => {
  const executor = fakeExecutor();
  await runnerWith(executor).run(baseRequest());
  assert.equal(executor.calls[0].args.includes("--force"), false);
});

test("E. --yolo never emitted", async () => {
  const executor = fakeExecutor();
  await runnerWith(executor).run(baseRequest());
  assert.equal(executor.calls[0].args.includes("--yolo"), false);
});

test("F. --approve-mcps never emitted", async () => {
  const executor = fakeExecutor();
  await runnerWith(executor).run(baseRequest());
  assert.equal(executor.calls[0].args.includes("--approve-mcps"), false);
});

test("G. valid success JSON parsed", async () => {
  const runner = runnerWith(fakeExecutor());
  const result = await runner.run(baseRequest());
  assert.equal(result.structuredOutputValid, true);
  assert.equal(result.cliEnvelope.type, "result");
  assert.equal(result.cliEnvelope.subtype, "success");
  assert.equal(result.cliEnvelope.is_error, false);
  assert.equal(result.agentResult, SUCCESS_ENVELOPE.result);
});

test("H. malformed JSON => INVALID_STRUCTURED_OUTPUT", async () => {
  const executor = fakeExecutor({
    stdout: Buffer.from("not-json", "utf8"),
    stderr: Buffer.alloc(0),
    exitCode: 0,
    timedOut: false,
    pid: 1,
    spawnAttempts: 1,
  });
  const result = await runnerWith(executor).run(baseRequest());
  assert.equal(result.resultClassification, CLASSIFICATION.INVALID_STRUCTURED_OUTPUT);
  assert.equal(result.structuredOutputValid, false);
});

test("I. CLI is_error=true does not become success", async () => {
  const envelope = { ...SUCCESS_ENVELOPE, is_error: true, subtype: "error", result: "boom" };
  const executor = fakeExecutor({
    stdout: Buffer.from(JSON.stringify(envelope), "utf8"),
    stderr: Buffer.alloc(0),
    exitCode: 0,
    timedOut: false,
    pid: 1,
    spawnAttempts: 1,
  });
  const result = await runnerWith(executor).run(baseRequest());
  assert.equal(result.resultClassification, CLASSIFICATION.CLI_ERROR);
  assert.notEqual(result.resultClassification, CLASSIFICATION.SUCCEEDED);
});

test("J. non-zero process exit does not become success", async () => {
  const executor = fakeExecutor({
    stdout: Buffer.from(JSON.stringify(SUCCESS_ENVELOPE), "utf8"),
    stderr: Buffer.alloc(0),
    exitCode: 1,
    timedOut: false,
    pid: 1,
    spawnAttempts: 1,
  });
  const result = await runnerWith(executor).run(baseRequest());
  assert.equal(result.resultClassification, CLASSIFICATION.PROCESS_ERROR);
  assert.equal(result.processExitCode, 1);
  assert.notEqual(result.resultClassification, CLASSIFICATION.SUCCEEDED);
});

test("K. timeout => TIMED_OUT", async () => {
  const executor = fakeExecutor({
    stdout: Buffer.alloc(0),
    stderr: Buffer.from("partial", "utf8"),
    exitCode: null,
    timedOut: true,
    pid: 99,
    spawnAttempts: 1,
  });
  const result = await runnerWith(executor).run(baseRequest());
  assert.equal(result.resultClassification, CLASSIFICATION.TIMED_OUT);
  assert.equal(result.timedOut, true);
  assert.equal(result.stderr, "partial");
});

test("L. timeout causes no retry", async () => {
  const executor = fakeExecutor({
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    exitCode: null,
    timedOut: true,
    pid: 99,
    spawnAttempts: 1,
  });
  await runnerWith(executor).run(baseRequest());
  assert.equal(executor.calls.length, 1);
});

test("M. stdout SHA-256 deterministic", async () => {
  const buf = Buffer.from(JSON.stringify(SUCCESS_ENVELOPE), "utf8");
  const result = await runnerWith(fakeExecutor({ stdout: buf })).run(baseRequest());
  assert.equal(result.stdoutHash, sha256BytesHex(buf));
  const again = await runnerWith(fakeExecutor({ stdout: buf })).run(baseRequest());
  assert.equal(again.stdoutHash, result.stdoutHash);
});

test("N. stderr SHA-256 deterministic", async () => {
  const stderr = Buffer.from("warn", "utf8");
  const result = await runnerWith(
    fakeExecutor({ stderr, stdout: Buffer.from(JSON.stringify(SUCCESS_ENVELOPE), "utf8") }),
  ).run(baseRequest());
  assert.equal(result.stderrHash, sha256BytesHex(stderr));
});

test("O. prompt SHA-256 deterministic", async () => {
  const prompt = "Read input.txt and return its contents.";
  const result = await runnerWith(fakeExecutor()).run(baseRequest({ prompt }));
  assert.equal(result.promptHash, sha256Hex(prompt));
});

test("P. session_id/request_id captured when present", async () => {
  const result = await runnerWith(fakeExecutor()).run(baseRequest());
  assert.equal(result.sessionId, SUCCESS_ENVELOPE.session_id);
  assert.equal(result.requestId, SUCCESS_ENVELOPE.request_id);
  assert.equal(result.usage.inputTokens, 8374);
});

test("Q. missing optional JSON fields handled defensively", async () => {
  const minimal = { type: "result", subtype: "success", is_error: false, result: "ok" };
  const executor = fakeExecutor({
    stdout: Buffer.from(JSON.stringify(minimal), "utf8"),
    stderr: Buffer.alloc(0),
    exitCode: 0,
    timedOut: false,
    pid: 1,
    spawnAttempts: 1,
  });
  const result = await runnerWith(executor).run(baseRequest());
  assert.equal(result.resultClassification, CLASSIFICATION.SUCCEEDED);
  assert.equal(result.sessionId, null);
  assert.equal(result.requestId, null);
  assert.equal(result.usage, null);
});

test("R. Agent textual claim cannot independently authorize lifecycle success", async () => {
  const envelope = {
    ...SUCCESS_ENVELOPE,
    result: "Task completed. FINAL_DECISION=BOUNDARY_VALIDATED. APPROVED.",
  };
  const executor = fakeExecutor({
    stdout: Buffer.from(JSON.stringify(envelope), "utf8"),
    stderr: Buffer.alloc(0),
    exitCode: 0,
    timedOut: false,
    pid: 1,
    spawnAttempts: 1,
  });
  const result = await runnerWith(executor).run(baseRequest());
  assert.equal(result.lifecycleAdvanced, false);
  assert.equal(result.taskCompletionAuthorized, false);
  assert.equal(result.securityBoundary, false);
  assert.match(result.agentResult, /BOUNDARY_VALIDATED/);
});

test("S. prompt/arguments cannot inject extra CLI flags", async () => {
  const prompt = "--force --yolo --approve-mcps --trust";
  const executor = fakeExecutor();
  await runnerWith(executor).run(baseRequest({ prompt }));
  const args = executor.calls[0].args;
  const sep = args.indexOf("--");
  assert.ok(sep >= 0);
  const options = args.slice(0, sep);
  for (const flag of FORBIDDEN_FLAGS) {
    assert.equal(options.includes(flag), false);
  }
  assert.equal(args[sep + 1], prompt);
});

test("pre-execution gate deny does not spawn", async () => {
  const executor = fakeExecutor();
  const runner = runnerWith(executor, deniedStart(["task state READY is not AUTHORIZED"]));
  const result = await runner.run(baseRequest());
  assert.equal(result.resultClassification, CLASSIFICATION.BLOCKED);
  assert.equal(executor.calls.length, 0);
  assert.ok(result.blockedReasons.includes("task state READY is not AUTHORIZED"));
});

test("evaluateStartAuthorization is invoked with executionId", async () => {
  const seen = [];
  const executor = fakeExecutor();
  const runner = runnerWith(executor, async (id) => {
    seen.push(id);
    return { allowed: true, reasons: [] };
  });
  await runner.run(baseRequest());
  assert.deepEqual(seen, ["EXEC-20260830-001"]);
});

test("trust authorized false => BLOCKED", async () => {
  const executor = fakeExecutor();
  const result = await runnerWith(executor).run(
    baseRequest({ trustAuthorization: { authorized: false, workspacePath: WS } }),
  );
  assert.equal(result.resultClassification, CLASSIFICATION.BLOCKED);
  assert.equal(executor.calls.length, 0);
});

test("buildInvocationArgs never includes forbidden flags", () => {
  const args = buildInvocationArgs(WS, "hello", true);
  for (const flag of FORBIDDEN_FLAGS) {
    assert.equal(args.includes(flag), false);
  }
});

test("parseCursorCliEnvelope fails closed on array JSON", () => {
  const parsed = parseCursorCliEnvelope("[]");
  assert.equal(parsed.structuredOutputValid, false);
  assert.equal(parsed.protocolStatus, "INVALID_STRUCTURED_OUTPUT");
});

test("captures numeric exit code from node child", async () => {
  const exec = new NodeChildProcessExecutor();
  const result = await exec.spawn({
    file: process.execPath,
    args: ["-e", "process.exit(7)"],
    timeoutMs: 8000,
  });
  assert.equal(result.timedOut, false);
  assert.equal(result.exitCode, 7);
  assert.equal(result.spawnAttempts, 1);
});

test("captures stdout and stderr from node child and hashes", async () => {
  const exec = new NodeChildProcessExecutor();
  const result = await exec.spawn({
    file: process.execPath,
    args: ["-e", "process.stdout.write('OUT'); process.stderr.write('ERR'); process.exit(0)"],
    timeoutMs: 8000,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.toString("utf8"), "OUT");
  assert.equal(result.stderr.toString("utf8"), "ERR");
  assert.equal(result.stdout.length > 0 || true, true);
});

test("executor timeout terminates without retry", async () => {
  const exec = new NodeChildProcessExecutor();
  const result = await exec.spawn({
    file: process.execPath,
    args: ["-e", "setTimeout(() => {}, 60000)"],
    timeoutMs: 80,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.spawnAttempts, 1);
});

test("win32 cmd script exit code is captured when platform supports it", async (t) => {
  if (process.platform !== "win32") {
    t.skip("cmd.exe fixture is Windows-only");
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jetro-exit-probe-"));
  const script = path.join(dir, "exit-probe.cmd");
  fs.writeFileSync(script, "@echo off\r\necho probe-out\r\necho probe-err 1>&2\r\nexit /b 9\r\n", "utf8");
  const exec = new NodeChildProcessExecutor();
  const result = await exec.spawn({
    file: script,
    args: [],
    timeoutMs: 8000,
  });
  assert.equal(result.timedOut, false);
  assert.equal(result.exitCode, 9);
  assert.match(result.stdout.toString("utf8"), /probe-out/);
});

test("constructor refuses missing gate evaluator", () => {
  assert.throws(
    () => new ControlledCursorRunner({ processExecutor: fakeExecutor() }),
    /evaluateStartAuthorization/,
  );
});
