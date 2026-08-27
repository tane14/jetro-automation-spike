import type {
  Event,
  Mission,
  Task,
  TaskDetailProjection,
} from "../domain/types.ts";

/**
 * Read-only control-plane data access.
 * GitHub remains the system of record. Implementations MUST NOT write,
 * approve, merge, dispatch agents, or mutate repository policy.
 */
export interface ControlPlaneDataSource {
  listMissions(): Promise<Mission[]>;
  getMission(id: string): Promise<Mission | null>;
  listTasks(): Promise<Task[]>;
  getTask(id: string): Promise<Task | null>;
  getTaskTimeline(id: string): Promise<Event[]>;
  getTaskDetail(id: string): Promise<TaskDetailProjection | null>;
}

/**
 * Reserved for a future read-only GitHub adapter.
 * Not implemented in Web MVP v0.5. Do not treat the UI as an authority source.
 *
 * A later GitHubControlPlaneDataSource would map GitHub REST/GraphQL reads
 * onto this same ControlPlaneDataSource interface. It must stay read-only.
 */
export type GitHubControlPlaneDataSource = ControlPlaneDataSource;
