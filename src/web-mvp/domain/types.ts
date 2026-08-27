export type AuthorityKind =
  | "github_human_approval"
  | "claude_review"
  | "markdown_evidence";

export type AuthorityRank = "authoritative" | "advisory" | "non-authoritative";

export type TaskState =
  | "draft"
  | "ready"
  | "in_progress"
  | "in_review"
  | "awaiting_approval"
  | "approved"
  | "blocked"
  | "done";

export type ApprovalStatus =
  | "not_requested"
  | "pending"
  | "approved"
  | "changes_requested"
  | "dismissed";

export type AgentKind = "human" | "cursor" | "claude" | "other";

export type ReviewKind = "github_human" | "claude";

export type PolicyConclusion = "pass" | "fail" | "neutral";

export interface Mission {
  id: string;
  title: string;
  objective: string;
  state: string;
  taskIds: string[];
}

export interface Agent {
  id: string;
  name: string;
  kind: AgentKind;
}

export interface Task {
  id: string;
  missionId: string;
  objective: string;
  state: TaskState;
  assignedAgentId: string | null;
  prNumber: number | null;
  prUrl: string | null;
  headSha: string | null;
  approvalStatus: ApprovalStatus;
}

export interface Execution {
  id: string;
  taskId: string;
  agentId: string;
  startedAt: string;
  finishedAt: string | null;
  summary: string;
}

export interface Review {
  id: string;
  taskId: string;
  kind: ReviewKind;
  author: string;
  state: string;
  submittedAt: string;
  commitId: string | null;
  body: string;
}

export interface Approval {
  id: string;
  taskId: string;
  authorityKind: AuthorityKind;
  reviewerLogin: string | null;
  commitId: string | null;
  submittedAt: string | null;
  artifactPath: string | null;
}

export interface Evidence {
  id: string;
  taskId: string;
  kind: "markdown" | "ci_log" | "attestation";
  path: string;
  summary: string;
  recordedAt: string;
}

export interface PolicyDecision {
  id: string;
  taskId: string;
  checkName: string;
  conclusion: PolicyConclusion;
  source: string;
  recordedAt: string;
}

export interface Event {
  id: string;
  taskId: string;
  occurredAt: string;
  type: string;
  summary: string;
}

export interface TimelineEntry {
  id: string;
  occurredAt: string;
  type: string;
  summary: string;
  authorityKind?: AuthorityKind;
}

export interface TaskDetailProjection {
  task: Task;
  assignedAgent: Agent | null;
  reviews: Review[];
  approvals: Approval[];
  evidence: Evidence[];
  policyDecisions: PolicyDecision[];
  executions: Execution[];
  timeline: TimelineEntry[];
}

export interface AuthorityLabel {
  kind: AuthorityKind;
  label: string;
  rank: AuthorityRank;
}
