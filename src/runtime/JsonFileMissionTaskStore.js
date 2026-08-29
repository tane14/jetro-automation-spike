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
    this.assignmentsDir = path.join(this.rootDir, "assignments");
    this.executionsDir = path.join(this.rootDir, "executions");
    this.transitionsDir = path.join(this.rootDir, "transitions");
    this.packagesDir = path.join(this.rootDir, "packages");
    this.handoffsDir = path.join(this.rootDir, "handoffs");
    this.outboxDir = path.join(this.rootDir, "exchange", "outbox");
    this.inboxDir = path.join(this.rootDir, "exchange", "inbox");
    this.preExecutionAcksDir = path.join(this.rootDir, "pre-execution-acks");
  }

  #missionPath(missionId) {
    assertCanonicalId("MISSION", missionId);
    return path.join(this.missionsDir, `${missionId}.json`);
  }

  #taskPath(taskId) {
    assertCanonicalId("TASK", taskId);
    return path.join(this.tasksDir, `${taskId}.json`);
  }

  #assignmentPath(taskId) {
    assertCanonicalId("TASK", taskId);
    return path.join(this.assignmentsDir, `${taskId}.json`);
  }

  #executionPath(executionId) {
    assertCanonicalId("EXEC", executionId);
    return path.join(this.executionsDir, `${executionId}.json`);
  }

  #packagePath(executionId) {
    assertCanonicalId("EXEC", executionId);
    return path.join(this.packagesDir, `${executionId}.json`);
  }

  #handoffPath(executionId) {
    assertCanonicalId("EXEC", executionId);
    return path.join(this.handoffsDir, `${executionId}.json`);
  }

  #outboxPath(executionId) {
    assertCanonicalId("EXEC", executionId);
    return path.join(this.outboxDir, `${executionId}.json`);
  }

  #inboxPath(executionId) {
    assertCanonicalId("EXEC", executionId);
    return path.join(this.inboxDir, `${executionId}.json`);
  }

  #preExecutionAckPath(executionId) {
    assertCanonicalId("EXEC", executionId);
    return path.join(this.preExecutionAcksDir, `${executionId}.json`);
  }

  #transitionFile(executionId, suffix) {
    assertCanonicalId("EXEC", executionId);
    if (suffix !== undefined && suffix !== null && suffix !== "") {
      if (typeof suffix !== "string" || !/^[A-Z0-9_-]+$/.test(suffix)) {
        throw new Error("invalid transition suffix");
      }
      return path.join(this.transitionsDir, `${executionId}.${suffix}.json`);
    }
    return path.join(this.transitionsDir, `${executionId}.json`);
  }

  async #listJsonDocs(dir) {
    if (!fs.existsSync(dir)) {
      return [];
    }
    const names = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
    const docs = [];
    for (const name of names.sort()) {
      const doc = readJsonIfPresent(path.join(dir, name));
      if (doc) docs.push(doc);
    }
    return docs;
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

  async putAssignment(doc) {
    if (!doc || typeof doc !== "object") {
      throw new Error("putAssignment requires an assignment document");
    }
    writeJsonAtomic(this.#assignmentPath(doc.task_id), doc);
    return doc;
  }

  async getAssignment(taskId) {
    return readJsonIfPresent(this.#assignmentPath(taskId));
  }

  async putExecution(doc) {
    if (!doc || typeof doc !== "object") {
      throw new Error("putExecution requires an execution document");
    }
    writeJsonAtomic(this.#executionPath(doc.execution_id), doc);
    return doc;
  }

  async getExecution(executionId) {
    return readJsonIfPresent(this.#executionPath(executionId));
  }

  async listExecutions() {
    return this.#listJsonDocs(this.executionsDir);
  }

  async listExecutionsByTask(taskId) {
    assertCanonicalId("TASK", taskId);
    const executions = await this.listExecutions();
    return executions.filter((item) => item && item.task_id === taskId);
  }

  async putTransition(doc, executionId, suffix) {
    if (!doc || typeof doc !== "object") {
      throw new Error("putTransition requires a lifecycle document");
    }
    writeJsonAtomic(this.#transitionFile(executionId, suffix), doc);
    return doc;
  }

  async putPackage(executionId, doc) {
    if (!doc || typeof doc !== "object") {
      throw new Error("putPackage requires a package document");
    }
    writeJsonAtomic(this.#packagePath(executionId), doc);
    return doc;
  }

  async getPackage(executionId) {
    return readJsonIfPresent(this.#packagePath(executionId));
  }

  async putHandoff(executionId, doc) {
    if (!doc || typeof doc !== "object") {
      throw new Error("putHandoff requires a handoff document");
    }
    writeJsonAtomic(this.#handoffPath(executionId), doc);
    return doc;
  }

  async getHandoff(executionId) {
    return readJsonIfPresent(this.#handoffPath(executionId));
  }

  async listHandoffs() {
    return this.#listJsonDocs(this.handoffsDir);
  }

  async listHandoffsByTask(taskId) {
    assertCanonicalId("TASK", taskId);
    const docs = await this.listHandoffs();
    return docs.filter((item) => item && item.task_id === taskId);
  }

  async putOutbox(executionId, doc) {
    if (!doc || typeof doc !== "object") {
      throw new Error("putOutbox requires a package document");
    }
    const filePath = this.#outboxPath(executionId);
    writeJsonAtomic(filePath, doc);
    return filePath;
  }

  async getOutbox(executionId) {
    return readJsonIfPresent(this.#outboxPath(executionId));
  }

  async putInbox(executionId, doc) {
    if (!doc || typeof doc !== "object") {
      throw new Error("putInbox requires a handoff document");
    }
    writeJsonAtomic(this.#inboxPath(executionId), doc);
    return doc;
  }

  async getInbox(executionId) {
    return readJsonIfPresent(this.#inboxPath(executionId));
  }

  async putPreExecutionAck(executionId, doc) {
    if (!doc || typeof doc !== "object") {
      throw new Error("putPreExecutionAck requires an ack document");
    }
    const filePath = this.#preExecutionAckPath(executionId);
    if (fs.existsSync(filePath)) {
      throw new Error("pre-execution ack already exists");
    }
    writeJsonAtomic(filePath, doc);
    return doc;
  }

  async getPreExecutionAck(executionId) {
    return readJsonIfPresent(this.#preExecutionAckPath(executionId));
  }
}

module.exports = {
  JsonFileMissionTaskStore,
  assertSafeRoot,
};
