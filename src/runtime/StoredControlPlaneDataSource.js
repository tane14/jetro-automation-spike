"use strict";

/**
 * Read-only ControlPlaneDataSource backed by MissionTaskStore JSON documents.
 *
 * Browser Vite UI must not import this module (Node fs). Tests and future
 * Node hosts inject it into App via the existing dataSource prop.
 *
 * Writing is forbidden here. valid:true is never human approval.
 */

const { assertStore } = require("./MissionTaskStore");

let projection;

async function loadProjection() {
  if (!projection) {
    const adapter = await import("../web-mvp/adapter/contractAdapter.js");
    const view = await import("../web-mvp/adapter/projectContractView.js");
    projection = {
      adaptContractBundle: adapter.adaptContractBundle,
      viewToMission: view.viewToMission,
      viewToTask: view.viewToTask,
    };
  }
  return projection;
}

function entryFor(mission, task, extras = {}) {
  return {
    id: task.task_id,
    scenario: "runtime-store",
    title: mission?.title || task.task_id,
    objective: Array.isArray(task.acceptance_criteria)
      ? task.acceptance_criteria[0]
      : "",
    bundle: {
      mission,
      task,
      ...(extras.assignment ? { assignment: extras.assignment } : {}),
      ...(extras.execution ? { execution: extras.execution } : {}),
      ...(extras.execution_handoff ? { execution_handoff: extras.execution_handoff } : {}),
      ...(extras.pre_execution_ack ? { pre_execution_ack: extras.pre_execution_ack } : {}),
    },
  };
}

function toDetail(view, viewToTask) {
  const assigned = view.assignedAgent;
  const assignedAgent = assigned
    ? {
        id: assigned.id,
        name: assigned.name,
        kind: assigned.kind,
      }
    : null;
  return {
    task: viewToTask(view),
    assignedAgent,
    reviews: [],
    approvals: [],
    evidence: (view.evidenceRefs || []).map((ref) => ({
      id: ref.evidence_id,
      taskId: view.taskId,
      kind: ref.kind === "markdown" ? "markdown" : "ci_log",
      path: ref.path,
      summary: "Evidence reference. Not authorization.",
      recordedAt: "1970-01-01T00:00:00.000Z",
    })),
    policyDecisions: view.policyCheck
      ? [
          {
            id: "policy-contract",
            taskId: view.taskId,
            checkName: view.policyCheck.checkName,
            conclusion: view.policyCheck.conclusion,
            source: view.policyCheck.policyVersion,
            recordedAt: "1970-01-01T00:00:00.000Z",
          },
        ]
      : [],
    executions: [],
    timeline: (view.handoffChain || []).map((step, index) => ({
      id: `chain:${step.key}`,
      occurredAt: `2026-08-28T18:0${index}:00.000Z`,
      type: step.key,
      summary: step.summary,
      authorityKind:
        step.rank === "advisory"
          ? "claude_review"
          : step.rank === "reference-only"
            ? "evidence_reference"
            : step.rank === "live-verification-required"
              ? "human_approval_gate"
              : "contract_record",
    })),
    contractView: view,
  };
}

class StoredControlPlaneDataSource {
  /**
   * @param {{ store: object }} options
   */
  constructor(options = {}) {
    this.store = assertStore(options.store);
  }

  async #bundleExtras(task) {
    const extras = {};
    if (typeof this.store.getAssignment === "function") {
      extras.assignment = await this.store.getAssignment(task.task_id);
    }
    if (typeof this.store.listExecutionsByTask === "function") {
      const executions = await this.store.listExecutionsByTask(task.task_id);
      extras.execution =
        executions.find((item) => item && (item.state === "LEASED" || item.state === "RUNNING")) ||
        executions[executions.length - 1] ||
        null;
    }
    if (extras.execution && typeof this.store.getHandoff === "function") {
      extras.execution_handoff = await this.store.getHandoff(extras.execution.execution_id);
    }
    if (extras.execution && typeof this.store.getPreExecutionAck === "function") {
      extras.pre_execution_ack = await this.store.getPreExecutionAck(extras.execution.execution_id);
    }
    return extras;
  }

  async #views() {
    const { adaptContractBundle } = await loadProjection();
    const [missions, tasks] = await Promise.all([
      this.store.listMissions(),
      this.store.listTasks(),
    ]);
    const missionById = new Map(missions.map((doc) => [doc.mission_id, doc]));
    const views = [];
    for (const task of tasks) {
      const extras = await this.#bundleExtras(task);
      views.push(
        adaptContractBundle(entryFor(missionById.get(task.mission_id) || null, task, extras)),
      );
    }
    return views;
  }

  async listMissions() {
    const { adaptContractBundle, viewToMission } = await loadProjection();
    const missions = await this.store.listMissions();
    const tasks = await this.store.listTasks();
    const projected = [];
    for (const mission of missions) {
      const taskIds = tasks
        .filter((task) => task.mission_id === mission.mission_id)
        .map((task) => task.task_id);
      const firstTask = tasks.find((task) => task.mission_id === mission.mission_id);
      if (firstTask) {
        const extras = await this.#bundleExtras(firstTask);
        const view = adaptContractBundle(entryFor(mission, firstTask, extras));
        projected.push(viewToMission(view, taskIds));
      } else {
        projected.push({
          id: mission.mission_id,
          title: mission.title,
          objective: mission.description || mission.title,
          state: mission.state,
          taskIds,
        });
      }
    }
    return projected;
  }

  async getMission(id) {
    const missions = await this.listMissions();
    return missions.find((mission) => mission.id === id) ?? null;
  }

  async listTasks() {
    const { viewToTask } = await loadProjection();
    const views = await this.#views();
    return views.map((view) => viewToTask(view));
  }

  async getTask(id) {
    const tasks = await this.listTasks();
    return tasks.find((task) => task.id === id) ?? null;
  }

  async getTaskTimeline(id) {
    const detail = await this.getTaskDetail(id);
    if (!detail) {
      return [];
    }
    return detail.timeline.map((entry) => ({
      id: entry.id,
      taskId: id,
      occurredAt: entry.occurredAt,
      type: entry.type,
      summary: entry.summary,
    }));
  }

  async getTaskDetail(id) {
    const { viewToTask } = await loadProjection();
    const views = await this.#views();
    const view = views.find((item) => item.taskId === id || item.id === id);
    if (!view) {
      return null;
    }
    return toDetail(view, viewToTask);
  }
}

module.exports = {
  StoredControlPlaneDataSource,
};
