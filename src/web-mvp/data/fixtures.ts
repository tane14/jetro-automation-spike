import type {
  Agent,
  Approval,
  Evidence,
  Event,
  Execution,
  Mission,
  PolicyDecision,
  Review,
  Task,
} from "../domain/types.ts";

export const agents: Agent[] = [
  { id: "agent-cursor", name: "Cursor agent", kind: "cursor" },
  { id: "agent-claude", name: "Claude reviewer", kind: "claude" },
  { id: "agent-human", name: "machubsystem-sketch", kind: "human" },
];

export const missions: Mission[] = [
  {
    id: "MISSION-CONTROL-PLANE-LAB",
    title: "JETRO Control Plane laboratory",
    objective:
      "Establish a read-mostly web view over laboratory missions, tasks, and provenance without becoming an authority source.",
    state: "active",
    taskIds: ["TASK-20260820-001", "TASK-20260826-001"],
  },
  {
    id: "MISSION-WEB-MVP",
    title: "Web Control Plane MVP",
    objective: "Ship a local Vite + React foundation that projects GitHub-backed facts.",
    state: "in_progress",
    taskIds: ["TASK-20260826-002"],
  },
];

export const tasks: Task[] = [
  {
    id: "TASK-20260820-001",
    missionId: "MISSION-CONTROL-PLANE-LAB",
    objective: "Harden approval provenance so GitHub human review is the authority source.",
    state: "approved",
    assignedAgentId: "agent-cursor",
    prNumber: 17,
    prUrl: "https://github.com/tane14/jetro-automation-spike/pull/17",
    headSha: "a4fd96ec4206b65f160b34ff77079cb34c065e94",
    approvalStatus: "approved",
  },
  {
    id: "TASK-20260826-001",
    missionId: "MISSION-CONTROL-PLANE-LAB",
    objective: "Keep Markdown approval artifacts as binding metadata, not as authority.",
    state: "in_review",
    assignedAgentId: "agent-cursor",
    prNumber: 18,
    prUrl: "https://github.com/tane14/jetro-automation-spike/pull/18",
    headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    approvalStatus: "pending",
  },
  {
    id: "TASK-20260826-002",
    missionId: "MISSION-WEB-MVP",
    objective: "Deliver the Web Control Plane MVP foundation v0.5 as a read-only local app.",
    state: "in_progress",
    assignedAgentId: "agent-cursor",
    prNumber: null,
    prUrl: null,
    headSha: null,
    approvalStatus: "not_requested",
  },
];

export const executions: Execution[] = [
  {
    id: "exec-001",
    taskId: "TASK-20260820-001",
    agentId: "agent-cursor",
    startedAt: "2026-08-20T12:00:00.000Z",
    finishedAt: "2026-08-20T15:00:00.000Z",
    summary: "Implemented approval-provenance check against GitHub review identity.",
  },
  {
    id: "exec-002",
    taskId: "TASK-20260826-002",
    agentId: "agent-cursor",
    startedAt: "2026-08-26T20:00:00.000Z",
    finishedAt: null,
    summary: "Building the nested Vite web MVP under src/web-mvp.",
  },
];

export const reviews: Review[] = [
  {
    id: "review-github-001",
    taskId: "TASK-20260820-001",
    kind: "github_human",
    author: "machubsystem-sketch",
    state: "APPROVED",
    submittedAt: "2026-08-20T16:10:00.000Z",
    commitId: "a4fd96ec4206b65f160b34ff77079cb34c065e94",
    body: "GitHub Pull Request review APPROVED for the current head.",
  },
  {
    id: "review-claude-001",
    taskId: "TASK-20260820-001",
    kind: "claude",
    author: "claude",
    state: "COMMENTED",
    submittedAt: "2026-08-20T15:40:00.000Z",
    commitId: "a4fd96ec4206b65f160b34ff77079cb34c065e94",
    body: "Advisory review only. Does not constitute human approval.",
  },
  {
    id: "review-claude-002",
    taskId: "TASK-20260826-001",
    kind: "claude",
    author: "claude",
    state: "COMMENTED",
    submittedAt: "2026-08-26T18:00:00.000Z",
    commitId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    body: "Advisory notes on labeling. Not an approval.",
  },
];

export const approvals: Approval[] = [
  {
    id: "approval-github-001",
    taskId: "TASK-20260820-001",
    authorityKind: "github_human_approval",
    reviewerLogin: "machubsystem-sketch",
    commitId: "a4fd96ec4206b65f160b34ff77079cb34c065e94",
    submittedAt: "2026-08-20T16:10:00.000Z",
    artifactPath: "control-plane/approvals/TASK-20260820-001.md",
  },
];

export const evidence: Evidence[] = [
  {
    id: "evidence-md-001",
    taskId: "TASK-20260820-001",
    kind: "markdown",
    path: "control-plane/evidence/TASK-20260820-001/cursor-execution.md",
    summary: "Execution notes. Derived laboratory evidence, not approval authority.",
    recordedAt: "2026-08-20T15:10:00.000Z",
  },
  {
    id: "evidence-md-002",
    taskId: "TASK-20260826-002",
    kind: "markdown",
    path: "control-plane/evidence/WEB_MVP_FOUNDATION_V05.md",
    summary: "Web MVP foundation evidence file. Non-authoritative documentation.",
    recordedAt: "2026-08-26T21:00:00.000Z",
  },
];

export const policyDecisions: PolicyDecision[] = [
  {
    id: "policy-001",
    taskId: "TASK-20260820-001",
    checkName: "approval-provenance",
    conclusion: "pass",
    source: "GitHub Actions control-plane-checks",
    recordedAt: "2026-08-20T16:20:00.000Z",
  },
  {
    id: "policy-002",
    taskId: "TASK-20260820-001",
    checkName: "task-boundary",
    conclusion: "pass",
    source: "GitHub Actions control-plane-checks",
    recordedAt: "2026-08-20T16:18:00.000Z",
  },
  {
    id: "policy-003",
    taskId: "TASK-20260826-002",
    checkName: "validation-evidence",
    conclusion: "neutral",
    source: "local projection",
    recordedAt: "2026-08-26T21:05:00.000Z",
  },
];

export const events: Event[] = [
  {
    id: "event-003",
    taskId: "TASK-20260820-001",
    occurredAt: "2026-08-20T16:30:00.000Z",
    type: "merge",
    summary: "Recorded as merged to main after GitHub human approval.",
  },
  {
    id: "event-001",
    taskId: "TASK-20260820-001",
    occurredAt: "2026-08-20T12:00:00.000Z",
    type: "opened",
    summary: "Task opened in the laboratory control plane.",
  },
  {
    id: "event-002",
    taskId: "TASK-20260820-001",
    occurredAt: "2026-08-20T14:00:00.000Z",
    type: "push",
    summary: "Head SHA updated on the task branch.",
  },
  {
    id: "event-004",
    taskId: "TASK-20260826-002",
    occurredAt: "2026-08-26T20:00:00.000Z",
    type: "opened",
    summary: "Web MVP foundation task opened.",
  },
];
