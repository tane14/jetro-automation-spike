"use strict";

/**
 * Independent validator for ControlledCursorRunner results.
 * Agent free-form text is data, never authority.
 * Not a security boundary. Not Task completion authority.
 */

function push(findings, ok, message) {
  if (!ok) {
    findings.push(message);
  }
}

/**
 * @param {object} result ControlledCursorRunner run result
 * @param {object} [expectations] externally supplied semantic checks
 * @returns {{ passed: boolean, findings: string[] }}
 */
function validateRunnerResult(result, expectations = {}) {
  const findings = [];
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { passed: false, findings: ["runner result missing"] };
  }

  push(findings, result.timedOut === false, "timedOut must be false");
  push(findings, result.spawnAttempts === 1, "spawnAttempts must be 1");
  const acceptable = Array.isArray(expectations.acceptableExitCodes)
    ? expectations.acceptableExitCodes
    : [0];
  push(
    findings,
    acceptable.includes(result.processExitCode),
    "process exit code is not acceptable",
  );
  push(findings, result.structuredOutputValid === true, "structuredOutputValid must be true");
  push(findings, result.cliProtocolStatus === "SUCCEEDED", "cliProtocolStatus must be SUCCEEDED");
  push(findings, result.resultClassification === "SUCCEEDED", "resultClassification must be SUCCEEDED");
  push(findings, result.lifecycleAdvanced === false, "lifecycleAdvanced must be false");
  push(
    findings,
    result.taskCompletionAuthorized === false,
    "taskCompletionAuthorized must be false",
  );
  push(findings, result.securityBoundary === false, "securityBoundary must be false");

  if (Object.prototype.hasOwnProperty.call(expectations, "expectedCanary")) {
    const canary = expectations.expectedCanary;
    const present = typeof result.agentResult === "string" && result.agentResult.includes(canary);
    push(findings, present, "expected canary is not present in agentResult");
  }

  if (
    Object.prototype.hasOwnProperty.call(expectations, "inputShaBefore") ||
    Object.prototype.hasOwnProperty.call(expectations, "inputShaAfter")
  ) {
    push(
      findings,
      expectations.inputShaBefore === expectations.inputShaAfter &&
        typeof expectations.inputShaBefore === "string" &&
        expectations.inputShaBefore.length === 64,
      "input hash before must equal input hash after",
    );
  }

  if (Object.prototype.hasOwnProperty.call(expectations, "workspaceIntegrityOk")) {
    push(findings, expectations.workspaceIntegrityOk === true, "workspace integrity is not ok");
  }
  if (Object.prototype.hasOwnProperty.call(expectations, "repositoryIntegrityOk")) {
    push(findings, expectations.repositoryIntegrityOk === true, "repository integrity is not ok");
  }

  return { passed: findings.length === 0, findings };
}

module.exports = {
  validateRunnerResult,
};
