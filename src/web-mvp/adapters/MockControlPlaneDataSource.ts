import type { ControlPlaneDataSource } from "./ControlPlaneDataSource.ts";
import { CONTRACT_SCENARIOS } from "../data/contractCatalog.js";
import { adaptContractBundle } from "../adapter/contractAdapter.js";
import { viewToMission, viewToTask } from "../adapter/projectContractView.js";
import type {
  Agent,
  AgentKind,
  Event,
  Mission,
  Task,
  TaskDetailProjection,
} from "../domain/types.ts";

function adaptedViews() {
  return CONTRACT_SCENARIOS.map((entry) => adaptContractBundle(entry));
}

export class MockControlPlaneDataSource implements ControlPlaneDataSource {
  #views = adaptedViews();

  async listMissions(): Promise<Mission[]> {
    const taskIds = this.#views.map((view) => view.taskId);
    const first = this.#views[0];
    if (!first) {
      return [];
    }
    return [viewToMission(first, taskIds)];
  }

  async getMission(id: string): Promise<Mission | null> {
    const missions = await this.listMissions();
    return missions.find((mission) => mission.id === id) ?? null;
  }

  async listTasks(): Promise<Task[]> {
    return this.#views.map((view) => viewToTask(view));
  }

  async getTask(id: string): Promise<Task | null> {
    const tasks = await this.listTasks();
    return tasks.find((task) => task.id === id) ?? null;
  }

  async getTaskTimeline(id: string): Promise<Event[]> {
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

  async getTaskDetail(id: string): Promise<TaskDetailProjection | null> {
    const view = this.#views.find((item) => item.taskId === id || item.id === id);
    if (!view) {
      return null;
    }
    const assigned = view.assignedAgent;
    const assignedAgent: Agent | null = assigned
      ? {
          id: assigned.id,
          name: assigned.name,
          kind: assigned.kind as AgentKind,
        }
      : null;
    return {
      task: viewToTask(view),
      assignedAgent,
      reviews: [],
      approvals: [],
      evidence: view.evidenceRefs.map((ref) => ({
        id: ref.evidence_id,
        taskId: view.taskId,
        kind: "markdown" as const,
        path: ref.path,
        summary: "Evidence reference. Not authorization.",
        recordedAt: "2026-08-28T18:00:00.000Z",
      })),
      policyDecisions: view.policyCheck
        ? [
            {
              id: "policy-contract",
              taskId: view.taskId,
              checkName: view.policyCheck.checkName,
              conclusion: view.policyCheck.conclusion as "pass" | "fail" | "neutral",
              source: view.policyCheck.policyVersion,
              recordedAt: "2026-08-28T18:00:00.000Z",
            },
          ]
        : [],
      executions: [],
      timeline: view.handoffChain.map((step, index) => ({
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
      contractView: view as TaskDetailProjection["contractView"],
    };
  }
}
