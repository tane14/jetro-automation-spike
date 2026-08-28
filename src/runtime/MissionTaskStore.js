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
