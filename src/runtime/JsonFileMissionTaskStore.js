"use strict";

/**
 * Local JSON-file implementation of MissionTaskStore.
 * One canonical v0.5 document per file. Not authority. Not Markdown storage.
 */

const fs = require("node:fs");
const path = require("node:path");
const { MissionTaskStore } = require("./MissionTaskStore");
const { assertCanonicalId } = require("./ids");

function normalizePath(filePath) {
  return path.resolve(filePath).replace(/\\/g, "/");
}

function assertSafeRoot(rootDir) {
  const normalized = normalizePath(rootDir);
  if (
    /\/control-plane\/tasks(?:\/|$)/.test(normalized) ||
    /\/control-plane\/approvals(?:\/|$)/.test(normalized)
  ) {
    throw new Error(
      "refusing to persist under control-plane/tasks or control-plane/approvals",
    );
  }
}

function readJsonIfPresent(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`invalid JSON at ${filePath}: ${err.message}`);
  }
}

function writeJsonAtomic(filePath, doc) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

class JsonFileMissionTaskStore extends MissionTaskStore {
  constructor(options = {}) {
    super();
    if (!options.rootDir || typeof options.rootDir !== "string") {
      throw new Error("JsonFileMissionTaskStore requires rootDir");
    }
    assertSafeRoot(options.rootDir);
    this.rootDir = path.resolve(options.rootDir);
    this.missionsDir = path.join(this.rootDir, "missions");
    this.tasksDir = path.join(this.rootDir, "tasks");
  }

  #missionPath(missionId) {
    assertCanonicalId("MISSION", missionId);
    return path.join(this.missionsDir, `${missionId}.json`);
  }

  #taskPath(taskId) {
    assertCanonicalId("TASK", taskId);
    return path.join(this.tasksDir, `${taskId}.json`);
  }

  async putMission(doc) {
    if (!doc || typeof doc !== "object") {
      throw new Error("putMission requires a mission document");
    }
    writeJsonAtomic(this.#missionPath(doc.mission_id), doc);
    return doc;
  }

  async getMission(missionId) {
    return readJsonIfPresent(this.#missionPath(missionId));
  }

  async listMissions() {
    if (!fs.existsSync(this.missionsDir)) {
      return [];
    }
    const names = fs.readdirSync(this.missionsDir).filter((name) => name.endsWith(".json"));
    const docs = [];
    for (const name of names.sort()) {
      const doc = readJsonIfPresent(path.join(this.missionsDir, name));
      if (doc) docs.push(doc);
    }
    return docs;
  }

  async putTask(doc) {
    if (!doc || typeof doc !== "object") {
      throw new Error("putTask requires a task document");
    }
    writeJsonAtomic(this.#taskPath(doc.task_id), doc);
    return doc;
  }

  async getTask(taskId) {
    return readJsonIfPresent(this.#taskPath(taskId));
  }

  async listTasks() {
    if (!fs.existsSync(this.tasksDir)) {
      return [];
    }
    const names = fs.readdirSync(this.tasksDir).filter((name) => name.endsWith(".json"));
    const docs = [];
    for (const name of names.sort()) {
      const doc = readJsonIfPresent(path.join(this.tasksDir, name));
      if (doc) docs.push(doc);
    }
    return docs;
  }

  async listTasksByMission(missionId) {
    assertCanonicalId("MISSION", missionId);
    const tasks = await this.listTasks();
    return tasks.filter((task) => task && task.mission_id === missionId);
  }
}

module.exports = {
  JsonFileMissionTaskStore,
  assertSafeRoot,
};
