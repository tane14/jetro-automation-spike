export type AuthorityKind =
  | "github_human_approval"
  | "claude_review"
  | "markdown_evidence"
  | "evidence_reference"
  | "human_approval_gate"
  | "contract_record";

export type AuthorityRank =
  | "authoritative"
  | "advisory"
  | "non-authoritative"
  | "reference-only"
  | "live-verification-required";

export type TaskState =
  | "draft"
  | "ready"
  | "in_progress"
  | "in_review"
  | "awaiting_approval"
  | "approved"
  | "blocked"
  | "done"
  | "PLANNED"
  | "READY"
  | "AUTHORIZED"
  | "IN_PROGRESS"
  | "REVIEW_READY"
  | "REVIEWED"
  | "CHANGES_REQUESTED"
  | "APPROVED"
  | "MERGE_READY"
  | "MERGED"
  | "BLOCKED"
  | "FAILED"
  | "CANCELLED";

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
  role?: string;
}

export interface Task {
  id: string;
  missionId: string;
  objective: string;
  state: TaskState | string;
  assignedAgentId: string | null;
  prNumber: number | null;
  prUrl: string | null;
  headSha: string | null;
  approvalStatus: ApprovalStatus | string;
  chainConsistency?: "valid" | "invalid" | "inconsistent";
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
  contractView?: ContractTaskView;
}

export interface ContractHandoffStep {
  key: string;
  title: string;
  rank: AuthorityRank;
  rankDisplay: string;
  summary: string;
  present: boolean;
}

export interface ContractTaskView {
  id: string;
  scenario: string;
  taskId: string;
  missionId: string;
  missionTitle: string;
  objective: string;
  assignedAgent: Agent | null;
  lifecycleState: string;
  riskTier: string | null;
  contractId: string;
  schemaVersion: string;
  contractHash: string;
  executionStatus: string | null;
  prNumber: number | null;
  prUrl: string | null;
  headSha: string | null;
  evidenceRefs: Array<{
    evidence_id: string;
    kind: string;
    path: string;
    authority_rank: string;
    input_role: string;
  }>;
  reviewStatus: string | null;
  humanApprovalStatus: string;
  chainConsistency: "valid" | "invalid" | "inconsistent";
  consistencyErrors: string[];
  sufficientForAuthority: false;
  requiresLiveGithubApproval: true;
  approvalStatus: string;
  handoffChain: ContractHandoffStep[];
  reviewKind: string;
  evidenceKind: string;
  gateKind: string;
  markdownKind: string;
  policyCheck: {
    policyVersion: string;
    checkName: string;
    conclusion: string;
    inputRole: string;
  } | null;
}

export interface AuthorityLabel {
  kind: AuthorityKind;
  label: string;
  rank: AuthorityRank;
  displayRank?: string;
}
