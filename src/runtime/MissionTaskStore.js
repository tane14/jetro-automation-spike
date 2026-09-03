"use strict";

/**
 * Persistence port for Mission and Task Contract documents (v0.5).
 *
 * Implementations store JSON documents only. They MUST NOT interpret
 * authority, lease, GitHub approval, Markdown, or evidence.
 * They MUST NOT write control-plane/tasks/*.md or control-plane/approvals/*.md.
 *
 * This is not a database product, HTTP API, or source of authority.
 */

class MissionTaskStore {
  async putMission(_doc) {
    throw new Error("MissionTaskStore.putMission is not implemented");
  }

  async getMission(_missionId) {
    throw new Error("MissionTaskStore.getMission is not implemented");
  }

  async listMissions() {
    throw new Error("MissionTaskStore.listMissions is not implemented");
  }

  async putTask(_doc) {
    throw new Error("MissionTaskStore.putTask is not implemented");
  }

  async getTask(_taskId) {
    throw new Error("MissionTaskStore.getTask is not implemented");
  }

  async listTasks() {
    throw new Error("MissionTaskStore.listTasks is not implemented");
  }

  async listTasksByMission(_missionId) {
    throw new Error("MissionTaskStore.listTasksByMission is not implemented");
  }

  async putAssignment(_doc) {
    throw new Error("MissionTaskStore.putAssignment is not implemented");
  }

  async getAssignment(_taskId) {
    throw new Error("MissionTaskStore.getAssignment is not implemented");
  }

  async putExecution(_doc) {
    throw new Error("MissionTaskStore.putExecution is not implemented");
  }

  async getExecution(_executionId) {
    throw new Error("MissionTaskStore.getExecution is not implemented");
  }

  async listExecutions() {
    throw new Error("MissionTaskStore.listExecutions is not implemented");
  }

  async listExecutionsByTask(_taskId) {
    throw new Error("MissionTaskStore.listExecutionsByTask is not implemented");
  }

  async putTransition(_doc, _executionId) {
    throw new Error("MissionTaskStore.putTransition is not implemented");
  }

  async getTransition(_executionId, _suffix) {
    throw new Error("MissionTaskStore.getTransition is not implemented");
  }

  async listTransitions(_executionId) {
    throw new Error("MissionTaskStore.listTransitions is not implemented");
  }

  async putRunnerAttempt(_executionId, _doc) {
    throw new Error("MissionTaskStore.putRunnerAttempt is not implemented");
  }

  async getRunnerAttempt(_executionId) {
    throw new Error("MissionTaskStore.getRunnerAttempt is not implemented");
  }

  async putPackage(_executionId, _doc) {
    throw new Error("MissionTaskStore.putPackage is not implemented");
  }

  async getPackage(_executionId) {
    throw new Error("MissionTaskStore.getPackage is not implemented");
  }

  async putHandoff(_executionId, _doc) {
    throw new Error("MissionTaskStore.putHandoff is not implemented");
  }

  async getHandoff(_executionId) {
    throw new Error("MissionTaskStore.getHandoff is not implemented");
  }

  async listHandoffs() {
    throw new Error("MissionTaskStore.listHandoffs is not implemented");
  }

  async listHandoffsByTask(_taskId) {
    throw new Error("MissionTaskStore.listHandoffsByTask is not implemented");
  }

  async putOutbox(_executionId, _doc) {
    throw new Error("MissionTaskStore.putOutbox is not implemented");
  }

  async getOutbox(_executionId) {
    throw new Error("MissionTaskStore.getOutbox is not implemented");
  }

  async putInbox(_executionId, _doc) {
    throw new Error("MissionTaskStore.putInbox is not implemented");
  }

  async getInbox(_executionId) {
    throw new Error("MissionTaskStore.getInbox is not implemented");
  }

  async putPreExecutionAck(_executionId, _doc) {
    throw new Error("MissionTaskStore.putPreExecutionAck is not implemented");
  }

  async getPreExecutionAck(_executionId) {
    throw new Error("MissionTaskStore.getPreExecutionAck is not implemented");
  }

  async putReviewHandoff(_reviewId, _doc) {
    throw new Error("MissionTaskStore.putReviewHandoff is not implemented");
  }

  async getReviewHandoff(_reviewId) {
    throw new Error("MissionTaskStore.getReviewHandoff is not implemented");
  }

  async listReviewHandoffs() {
    throw new Error("MissionTaskStore.listReviewHandoffs is not implemented");
  }

  async putReviewResult(_reviewId, _doc) {
    throw new Error("MissionTaskStore.putReviewResult is not implemented");
  }

  async getReviewResult(_reviewId) {
    throw new Error("MissionTaskStore.getReviewResult is not implemented");
  }

  async listReviewResults() {
    throw new Error("MissionTaskStore.listReviewResults is not implemented");
  }
}

function assertStore(store) {
  if (!store || typeof store !== "object") {
    throw new Error("MissionTaskStore is required");
  }
  const methods = [
    "putMission",
    "getMission",
    "listMissions",
    "putTask",
    "getTask",
    "listTasks",
    "listTasksByMission",
    "putAssignment",
    "getAssignment",
    "putExecution",
    "getExecution",
    "listExecutions",
    "listExecutionsByTask",
    "putTransition",
    "putPackage",
    "getPackage",
    "putHandoff",
    "getHandoff",
    "listHandoffs",
    "listHandoffsByTask",
    "putOutbox",
    "getOutbox",
    "putInbox",
    "getInbox",
    "putPreExecutionAck",
    "getPreExecutionAck",
  ];
  for (const name of methods) {
    if (typeof store[name] !== "function") {
      throw new Error(`MissionTaskStore missing ${name}`);
    }
  }
  return store;
}

module.exports = {
  MissionTaskStore,
  assertStore,
};
