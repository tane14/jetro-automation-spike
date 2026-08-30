"use strict";

/**
 * ControlledCursorRunner v0.1 — adapter/runtime capability.
 *
 * RISK_TIER=T1, ENVIRONMENT=LAB_ONLY, SECURITY_BOUNDARY=NO.
 * Not authorized for production, VPS, JETRO-IBE, AWS, databases, T2/T3.
 *
 * Executes an already-authorized request. PreExecutionGateRuntime remains
 * start-authorization authority. This runner does not advance Task lifecycle
 * and is not the Evidence Ledger.
 *
 * --trust is emitted only for the exact authorized workspace.
 * Never emits --force, --yolo, or --approve-mcps.
 * Never retries Agent invocation.
 */

const { sha256Hex } = require("../contracts/sha256");
const { assertCanonicalId } = require("./ids");
const { sha256BytesHex } = require("./sha256Bytes");
const { parseCursorCliEnvelope } = require("./cursorCliEnvelope");
const { pathsExactlyBound, canonicalizeWorkspacePath } = require("./workspacePath");
const { FORBIDDEN_FLAGS } = require("./NodeChildProcessExecutor");

const DEFAULT_TIMEOUT_MS = 180000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const LAB_DEFAULT_AGENT_PATH =
  "C:\\Users\\Alexandre\\AppData\\Local\\cursor-agent\\agent.cmd";

const CLASSIFICATION = Object.freeze({
  SUCCEEDED: "SUCCEEDED",
  CLI_ERROR: "CLI_ERROR",
  PROCESS_ERROR: "PROCESS_ERROR",
  TIMED_OUT: "TIMED_OUT",
  INVALID_STRUCTURED_OUTPUT: "INVALID_STRUCTURED_OUTPUT",
  BLOCKED: "BLOCKED",
});

const REQUEST_KEYS = new Set([
  "runId",
  "taskId",
  "contractId",
  "executionId",
  "workspacePath",
  "prompt",
  "timeoutMs",
  "trustAuthorization",
]);

function isoNow(clock) {
  return clock().toISOString();
}

function blockedResult(base, reasons) {
  return {
    ...base,
    timedOut: false,
    processId: null,
    processExitCode: null,
    stdout: "",
    stderr: "",
    stdoutHash: sha256BytesHex(Buffer.alloc(0)),
    stderrHash: sha256BytesHex(Buffer.alloc(0)),
    structuredOutputValid: false,
    cliEnvelope: null,
    agentResult: null,
    sessionId: null,
    requestId: null,
    usage: null,
    resultClassification: CLASSIFICATION.BLOCKED,
    processExitStatus: "NOT_STARTED",
    cliProtocolStatus: "NOT_STARTED",
    lifecycleAdvanced: false,
    taskCompletionAuthorized: false,
    securityBoundary: false,
    riskTier: "T1",
    environment: "LAB_ONLY",
    spawnAttempts: 0,
    blockedReasons: Array.isArray(reasons) ? reasons : [String(reasons)],
  };
}

function validateTrustAuthorization(trust, workspaceCanonical) {
  if (!trust || typeof trust !== "object" || Array.isArray(trust)) {
    return { ok: false, reason: "trust authorization missing" };
  }
  if (trust.authorized !== true) {
    return { ok: false, reason: "trust authorization is not explicitly true" };
  }
  if (typeof trust.workspacePath !== "string") {
    return { ok: false, reason: "trust authorization workspacePath missing" };
  }
  const bound = pathsExactlyBound(trust.workspacePath, workspaceCanonical);
  if (!bound.ok) {
    return { ok: false, reason: bound.reason };
  }
  return { ok: true, reason: null, canonical: bound.canonical };
}

function buildInvocationArgs(workspacePath, prompt, includeTrust) {
  const args = [
    "--print",
    "--output-format",
    "json",
    "--mode",
    "ask",
    "--workspace",
    workspacePath,
  ];
  if (includeTrust) {
    args.push("--trust");
  }
  args.push("--", prompt);
  return args;
}

function classifyRun({ timedOut, exitCode, protocolStatus, structuredOutputValid }) {
  if (timedOut) {
    return CLASSIFICATION.TIMED_OUT;
  }
  if (exitCode !== 0) {
    return CLASSIFICATION.PROCESS_ERROR;
  }
  if (!structuredOutputValid) {
    return CLASSIFICATION.INVALID_STRUCTURED_OUTPUT;
  }
  if (protocolStatus === CLASSIFICATION.CLI_ERROR) {
    return CLASSIFICATION.CLI_ERROR;
  }
  if (protocolStatus === CLASSIFICATION.SUCCEEDED) {
    return CLASSIFICATION.SUCCEEDED;
  }
  return CLASSIFICATION.INVALID_STRUCTURED_OUTPUT;
}

class ControlledCursorRunner {
  /**
   * @param {{
   *   processExecutor: { spawn: Function },
   *   evaluateStartAuthorization: (executionId: string) => Promise<object>,
   *   agentPath?: string,
   *   cliVersion?: string,
   *   clock?: () => Date,
   *   defaultTimeoutMs?: number,
   * }} options
   */
  constructor(options = {}) {
    if (!options.processExecutor || typeof options.processExecutor.spawn !== "function") {
      throw new Error("ControlledCursorRunner requires processExecutor.spawn");
    }
    if (typeof options.evaluateStartAuthorization !== "function") {
      throw new Error("ControlledCursorRunner requires evaluateStartAuthorization from PreExecutionGate");
    }
    this.processExecutor = options.processExecutor;
    this.evaluateStartAuthorization = options.evaluateStartAuthorization;
    this.agentPath = typeof options.agentPath === "string" ? options.agentPath : LAB_DEFAULT_AGENT_PATH;
    this.cliVersion = typeof options.cliVersion === "string" ? options.cliVersion : null;
    this.clock = typeof options.clock === "function" ? options.clock : () => new Date();
    this.defaultTimeoutMs =
      Number.isInteger(options.defaultTimeoutMs) && options.defaultTimeoutMs > 0
        ? options.defaultTimeoutMs
        : DEFAULT_TIMEOUT_MS;
  }

  plannedInvocation(workspacePath, prompt, includeTrust) {
    return {
      file: this.agentPath,
      args: buildInvocationArgs(workspacePath, prompt, includeTrust),
    };
  }

  async run(request = {}) {
    const startedAt = isoNow(this.clock);
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      return blockedResult(
        this._identityStub(request, startedAt, startedAt, 0, null, ""),
        ["request must be an object"],
      );
    }
    const extra = Object.keys(request).filter((key) => !REQUEST_KEYS.has(key));
    if (extra.length) {
      return blockedResult(
        this._identityStub(request, startedAt, startedAt, 0, null, ""),
        [`unknown request field: ${extra.join(", ")}`],
      );
    }

    const idErrors = [];
    try {
      assertCanonicalId("TASK", request.taskId);
    } catch (err) {
      idErrors.push(err.message);
    }
    try {
      assertCanonicalId("CONTRACT", request.contractId);
    } catch (err) {
      idErrors.push(err.message);
    }
    try {
      assertCanonicalId("EXEC", request.executionId);
    } catch (err) {
      idErrors.push(err.message);
    }
    if (typeof request.runId !== "string" || request.runId.trim() === "") {
      idErrors.push("runId is required");
    }
    if (typeof request.prompt !== "string" || request.prompt.trim() === "") {
      idErrors.push("prompt is required");
    }
    const timeoutMs =
      request.timeoutMs === undefined || request.timeoutMs === null
        ? this.defaultTimeoutMs
        : request.timeoutMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
      idErrors.push("timeoutMs is invalid");
    }
    const ws = canonicalizeWorkspacePath(request.workspacePath);
    if (!ws.ok) {
      idErrors.push(ws.reason);
    }
    if (idErrors.length) {
      return blockedResult(
        this._identityStub(request, startedAt, isoNow(this.clock), 0, timeoutMs, ""),
        idErrors,
      );
    }

    const trust = validateTrustAuthorization(request.trustAuthorization, ws.canonical);
    const promptHash = sha256Hex(request.prompt);
    const identity = this._identityStub(
      request,
      startedAt,
      startedAt,
      0,
      timeoutMs,
      promptHash,
      ws.canonical,
    );
    if (!trust.ok) {
      return blockedResult(identity, [trust.reason]);
    }

    let startAuth;
    try {
      startAuth = await this.evaluateStartAuthorization(request.executionId);
    } catch (err) {
      return blockedResult(identity, [err instanceof Error ? err.message : "start authorization evaluation failed"]);
    }
    if (!startAuth || startAuth.allowed !== true) {
      const reasons =
        startAuth && Array.isArray(startAuth.reasons) && startAuth.reasons.length
          ? startAuth.reasons
          : ["pre-execution start authorization is not allowed"];
      return blockedResult(identity, reasons);
    }

    const invocation = this.plannedInvocation(ws.canonical, request.prompt, true);
    for (const flag of FORBIDDEN_FLAGS) {
      if (invocation.args.includes(flag)) {
        return blockedResult(identity, [`forbidden CLI flag planned: ${flag}`]);
      }
    }

    const commandIdentity = {
      file: invocation.file,
      args: invocation.args.slice(0, invocation.args.length - 1).concat(["<prompt>"]),
    };

    const spawnStarted = this.clock();
    const spawnStartedAt = spawnStarted.toISOString();
    const execResult = await this.processExecutor.spawn({
      file: invocation.file,
      args: invocation.args,
      timeoutMs,
    });
    const finished = this.clock();
    const finishedAt = finished.toISOString();
    const durationMs = Math.max(0, finished.getTime() - spawnStarted.getTime());

    const stdoutBuf = Buffer.isBuffer(execResult.stdout)
      ? execResult.stdout
      : Buffer.from(execResult.stdout || "");
    const stderrBuf = Buffer.isBuffer(execResult.stderr)
      ? execResult.stderr
      : Buffer.from(execResult.stderr || "");
    const stdout = stdoutBuf.toString("utf8");
    const stderr = stderrBuf.toString("utf8");
    const parsed = parseCursorCliEnvelope(stdout);
    const timedOut = execResult.timedOut === true;
    const exitCode = typeof execResult.exitCode === "number" ? execResult.exitCode : null;
    const classification = classifyRun({
      timedOut,
      exitCode,
      protocolStatus: parsed.protocolStatus,
      structuredOutputValid: parsed.structuredOutputValid,
    });

    return {
      runId: request.runId,
      taskId: request.taskId,
      contractId: request.contractId,
      executionId: request.executionId,
      commandIdentity,
      cliVersion: this.cliVersion,
      workspacePath: ws.canonical,
      promptHash,
      startedAt: spawnStartedAt,
      finishedAt,
      durationMs,
      processId: typeof execResult.pid === "number" ? execResult.pid : null,
      processExitCode: exitCode,
      timedOut,
      stdout,
      stderr,
      stdoutHash: sha256BytesHex(stdoutBuf),
      stderrHash: sha256BytesHex(stderrBuf),
      structuredOutputValid: parsed.structuredOutputValid,
      cliEnvelope: parsed.envelope,
      agentResult: parsed.agentResult,
      sessionId: parsed.sessionId,
      requestId: parsed.requestId,
      usage: parsed.usage,
      resultClassification: classification,
      processExitStatus: timedOut ? "TIMED_OUT" : exitCode === 0 ? "EXIT_ZERO" : "EXIT_NONZERO_OR_MISSING",
      cliProtocolStatus: parsed.protocolStatus,
      parseError: parsed.parseError,
      lifecycleAdvanced: false,
      taskCompletionAuthorized: false,
      securityBoundary: false,
      riskTier: "T1",
      environment: "LAB_ONLY",
      spawnAttempts: execResult.spawnAttempts === undefined ? 1 : execResult.spawnAttempts,
      blockedReasons: [],
    };
  }

  _identityStub(request, startedAt, finishedAt, durationMs, timeoutMs, promptHash, workspacePath) {
    return {
      runId: request && request.runId ? request.runId : null,
      taskId: request && request.taskId ? request.taskId : null,
      contractId: request && request.contractId ? request.contractId : null,
      executionId: request && request.executionId ? request.executionId : null,
      commandIdentity: null,
      cliVersion: this.cliVersion,
      workspacePath: workspacePath || null,
      promptHash: promptHash || (typeof request.prompt === "string" ? sha256Hex(request.prompt) : null),
      startedAt,
      finishedAt,
      durationMs,
      timeoutMs: timeoutMs || this.defaultTimeoutMs,
    };
  }
}

module.exports = {
  ControlledCursorRunner,
  CLASSIFICATION,
  DEFAULT_TIMEOUT_MS,
  LAB_DEFAULT_AGENT_PATH,
  buildInvocationArgs,
};
