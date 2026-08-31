"use strict";

/**
 * Evidence DATA for a governed Cursor run.
 * Not an append-only ledger. EVIDENCE_AUTHORITY=NO.
 * Not Task completion authority.
 */

const { utcDateStamp, nextId } = require("./ids");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildContractProvenance({ task, ack, dispatchPackage }) {
  return {
    pre_authorization_contract_hash:
      dispatchPackage && typeof dispatchPackage.task_contract_hash === "string"
        ? dispatchPackage.task_contract_hash
        : null,
    authorized_contract_hash: task && typeof task.contract_hash === "string" ? task.contract_hash : null,
    ack_contract_hash: ack && typeof ack.contract_hash === "string" ? ack.contract_hash : null,
  };
}

function nextEvidenceId(clock, existingIds) {
  const stamp = utcDateStamp(clock());
  return nextId("EVD", stamp, existingIds || []);
}

/**
 * @param {object} input
 */
function buildGovernedRunEvidence(input) {
  const provenance =
    input.provenance ||
    buildContractProvenance({
      task: input.task,
      ack: input.ack,
      dispatchPackage: input.dispatchPackage,
    });
  const result = input.runnerResult || {};
  const validation = input.validation || { passed: false, findings: ["validation missing"] };
  const commandIdentity = result.commandIdentity || null;
  const persistedExecutionState =
    input.execution && typeof input.execution.state === "string" ? input.execution.state : null;
  const persistedTaskState = input.task && typeof input.task.state === "string" ? input.task.state : null;
  const transitionPersisted = input.transitionPersisted === true;

  let lifecycleTransition;
  if (transitionPersisted && persistedExecutionState === "RESULT_SUBMITTED" && persistedTaskState === "REVIEW_READY") {
    lifecycleTransition = {
      execution: "RUNNING->RESULT_SUBMITTED",
      task: "IN_PROGRESS->REVIEW_READY",
    };
  } else if (transitionPersisted && persistedExecutionState === "FAILED" && persistedTaskState === "FAILED") {
    lifecycleTransition = {
      execution: "RUNNING->FAILED",
      task: "IN_PROGRESS->FAILED",
    };
  } else {
    lifecycleTransition = {
      execution: persistedExecutionState ? `persisted:${persistedExecutionState}` : "unknown",
      task: persistedTaskState ? `persisted:${persistedTaskState}` : "unknown",
    };
  }

  return {
    schema_version: "0.5-governed-run-evidence-data",
    record_kind: "governed_run_evidence_data",
    evidence_id: input.evidenceId,
    authority_claim: "none",
    input_role: "reference_only",
    evidenceAuthority: false,
    evidence_ledger_append_only: false,
    lifecycleAuthority: false,
    taskCompletionAuthorized: false,
    runId: result.runId || input.runId || null,
    taskId: input.task && input.task.task_id,
    contractId: input.task && input.task.contract_id,
    executionId: input.execution && input.execution.execution_id,
    canonicalMainSha: input.canonicalMainSha || (input.execution && input.execution.base_sha) || null,
    baseSha: input.execution && input.execution.base_sha,
    contractProvenance: provenance,
    workspacePath: result.workspacePath || input.workspacePath || null,
    inputShaBefore: input.expectations && input.expectations.inputShaBefore ? input.expectations.inputShaBefore : null,
    inputShaAfter: input.expectations && input.expectations.inputShaAfter ? input.expectations.inputShaAfter : null,
    promptSha: result.promptHash || null,
    runnerIdentity: "ControlledCursorRunner",
    runnerVersion: "v0.1.1",
    cliVersion: result.cliVersion || null,
    resolvedExecutable: commandIdentity && commandIdentity.resolvedFile ? commandIdentity.resolvedFile : null,
    gateAuthorizationReference: input.ack
      ? {
          execution_id: input.ack.execution_id,
          acknowledged_by: clone(input.ack.acknowledged_by),
          acknowledged_at: input.ack.acknowledged_at,
          scope: input.ack.scope,
          substitutes_for_github_review: false,
        }
      : null,
    startedAt: result.startedAt || null,
    finishedAt: result.finishedAt || null,
    durationMs: typeof result.durationMs === "number" ? result.durationMs : null,
    pid: typeof result.processId === "number" ? result.processId : null,
    processExitCode: result.processExitCode === undefined ? null : result.processExitCode,
    timedOut: result.timedOut === true,
    spawnAttempts: result.spawnAttempts === undefined ? null : result.spawnAttempts,
    stdoutSha256: result.stdoutHash || null,
    stderrSha256: result.stderrHash || null,
    structuredOutputValid: result.structuredOutputValid === true,
    protocolStatus: result.cliProtocolStatus || null,
    resultClassification: result.resultClassification || null,
    validationStatus: validation.passed === true ? "PASS" : "FAIL",
    validationFindings: Array.isArray(validation.findings) ? validation.findings.slice() : [],
    repositoryIntegrityOk:
      input.expectations && input.expectations.repositoryIntegrityOk === true ? true : false,
    workspaceIntegrityOk:
      input.expectations && input.expectations.workspaceIntegrityOk === true ? true : false,
    persistedExecutionState,
    persistedTaskState,
    transitionPersisted,
    lifecycleTransition,
    retryCount: 0,
    agentResultCaptured: typeof result.agentResult === "string",
  };
}

module.exports = {
  buildContractProvenance,
  buildGovernedRunEvidence,
  nextEvidenceId,
};
