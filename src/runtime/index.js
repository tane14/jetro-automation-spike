"use strict";

/**
 * Task Dispatch runtime v0.8, Executor Exchange runtime v0.9,
 * Pre-Execution Gate v1.0, ControlledCursorRunner v0.1.1,
 * governed execution lifecycle v1.4.1, governed execution recovery v1.5,
 * and reviewer automation v1.6.
 * Not an HTTP API, database, GitHub integration, or authority source.
 * ControlledCursorRunner is not a security boundary.
 * WINDOWS_DESCENDANT_TERMINATION_GUARANTEE=NO
 */

const { MissionTaskStore, assertStore } = require("./MissionTaskStore");
const { JsonFileMissionTaskStore } = require("./JsonFileMissionTaskStore");
const {
  MissionTaskRuntime,
  RuntimeValidationError,
} = require("./MissionTaskRuntime");
const { StoredControlPlaneDataSource } = require("./StoredControlPlaneDataSource");
const { TaskDispatchRuntime } = require("./TaskDispatchRuntime");
const { ExecutorExchangeRuntime } = require("./ExecutorExchangeRuntime");
const { PreExecutionGateRuntime } = require("./PreExecutionGateRuntime");
const {
  ControlledCursorRunner,
  CLASSIFICATION,
} = require("./ControlledCursorRunner");
const { NodeChildProcessExecutor } = require("./NodeChildProcessExecutor");
const { GovernedExecutionLifecycleRuntime } = require("./GovernedExecutionLifecycleRuntime");
const { GovernedExecutionRuntime, MemoryEvidenceSink } = require("./GovernedExecutionRuntime");
const {
  GovernedExecutionRecovery,
  CLASSIFICATION: RECOVERY_CLASSIFICATION,
} = require("./GovernedExecutionRecovery");
const { validateRunnerResult } = require("./RunnerResultValidator");
const { ReviewerAutomation, CLASSIFICATION: REVIEW_CLASSIFICATION } = require("./ReviewerAutomation");
const { ReviewerAdapter, FakeReviewerAdapter } = require("./ReviewerAdapter");
const { utcDateStamp, nextId, assertCanonicalId } = require("./ids");

module.exports = {
  MissionTaskStore,
  assertStore,
  JsonFileMissionTaskStore,
  MissionTaskRuntime,
  RuntimeValidationError,
  StoredControlPlaneDataSource,
  TaskDispatchRuntime,
  ExecutorExchangeRuntime,
  PreExecutionGateRuntime,
  ControlledCursorRunner,
  CLASSIFICATION,
  NodeChildProcessExecutor,
  GovernedExecutionLifecycleRuntime,
  GovernedExecutionRuntime,
  MemoryEvidenceSink,
  GovernedExecutionRecovery,
  RECOVERY_CLASSIFICATION,
  ReviewerAutomation,
  REVIEW_CLASSIFICATION,
  ReviewerAdapter,
  FakeReviewerAdapter,
  validateRunnerResult,
  utcDateStamp,
  nextId,
  assertCanonicalId,
};
