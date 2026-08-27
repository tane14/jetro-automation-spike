import type { ControlPlaneDataSource } from "./ControlPlaneDataSource.ts";
import { projectTaskDetail } from "../domain/projections.js";
import {
  agents,
  approvals,
  evidence,
  events,
  executions,
  missions,
  policyDecisions,
  reviews,
  tasks,
} from "../data/fixtures.ts";
import type {
  Event,
  Mission,
  Task,
  TaskDetailProjection,
} from "../domain/types.ts";

export class MockControlPlaneDataSource implements ControlPlaneDataSource {
  async listMissions(): Promise<Mission[]> {
    return missions;
  }

  async getMission(id: string): Promise<Mission | null> {
    return missions.find((mission) => mission.id === id) ?? null;
  }

  async listTasks(): Promise<Task[]> {
    return tasks;
  }

  async getTask(id: string): Promise<Task | null> {
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
    const task = await this.getTask(id);
    if (!task) {
      return null;
    }
    return projectTaskDetail({
      task,
      agents,
      reviews,
      approvals,
      evidence,
      policyDecisions,
      executions,
      events,
    }) as TaskDetailProjection;
  }
}
