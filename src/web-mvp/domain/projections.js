import { sortTimeline } from "./timeline.js";
import {
  authorityForApproval,
  authorityForEvidence,
  authorityForReview,
} from "./authority.js";

/** @type {Record<string, string>} */
export const TASK_STATE_LABELS = {
  draft: "Draft",
  ready: "Ready",
  in_progress: "In progress",
  in_review: "In review",
  awaiting_approval: "Awaiting approval",
  approved: "Approved",
  blocked: "Blocked",
  done: "Done",
  PLANNED: "Planned",
  READY: "Ready",
  AUTHORIZED: "Authorized (recorded)",
  IN_PROGRESS: "In progress",
  REVIEW_READY: "Review ready",
  REVIEWED: "Reviewed",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved (recorded, not GitHub proof)",
  MERGE_READY: "Merge ready (recorded)",
  MERGED: "Merged (recorded)",
  BLOCKED: "Blocked",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

/**
 * @param {string} state
 * @returns {string}
 */
export function taskStateLabel(state) {
  return TASK_STATE_LABELS[state] ?? state;
}

/**
 * @param {string | null} sha
 * @returns {string}
 */
export function formatHeadSha(sha) {
  if (!sha) {
    return "—";
  }
  return sha;
}

/**
 * @param {{
 *   task: object,
 *   agents: Array<{ id: string }>,
 *   reviews: Array<{ id: string, taskId: string, kind: string, submittedAt: string, author: string, state: string }>,
 *   approvals: Array<{ id: string, taskId: string, authorityKind: string, submittedAt: string | null, reviewerLogin: string | null }>,
 *   evidence: Array<{ id: string, taskId: string, recordedAt: string, path: string, summary: string }>,
 *   policyDecisions: Array<{ id: string, taskId: string, recordedAt: string, checkName: string, conclusion: string }>,
 *   executions: Array<{ id: string, taskId: string, startedAt: string, summary: string }>,
 *   events: Array<{ id: string, taskId: string, occurredAt: string, type: string, summary: string }>
 * }} input
 */
export function projectTaskDetail(input) {
  const {
    task,
    agents,
    reviews,
    approvals,
    evidence,
    policyDecisions,
    executions,
    events,
  } = input;

  const assignedAgent =
    agents.find((agent) => agent.id === task.assignedAgentId) ?? null;
  const taskReviews = reviews.filter((review) => review.taskId === task.id);
  const taskApprovals = approvals.filter((approval) => approval.taskId === task.id);
  const taskEvidence = evidence.filter((item) => item.taskId === task.id);
  const taskPolicies = policyDecisions.filter((item) => item.taskId === task.id);
  const taskExecutions = executions.filter((item) => item.taskId === task.id);

  /** @type {Array<{ id: string, occurredAt: string, type: string, summary: string, authorityKind?: string }>} */
  const derived = [
    ...events.filter((event) => event.taskId === task.id),
    ...taskReviews.map((review) => ({
      id: `review:${review.id}`,
      occurredAt: review.submittedAt,
      type: "review",
      summary: `${review.author} ${review.state}`,
      authorityKind: authorityForReview(review),
    })),
    ...taskApprovals.map((approval) => ({
      id: `approval:${approval.id}`,
      occurredAt: approval.submittedAt ?? "",
      type: "approval",
      summary: approval.reviewerLogin
        ? `${approval.reviewerLogin} approval record`
        : "approval record",
      authorityKind: authorityForApproval(approval),
    })),
    ...taskEvidence.map((item) => ({
      id: `evidence:${item.id}`,
      occurredAt: item.recordedAt,
      type: "evidence",
      summary: item.summary,
      authorityKind: authorityForEvidence(item),
    })),
    ...taskPolicies.map((item) => ({
      id: `policy:${item.id}`,
      occurredAt: item.recordedAt,
      type: "policy",
      summary: `${item.checkName}: ${item.conclusion}`,
    })),
    ...taskExecutions.map((item) => ({
      id: `execution:${item.id}`,
      occurredAt: item.startedAt,
      type: "execution",
      summary: item.summary,
    })),
  ];

  return {
    task,
    assignedAgent,
    reviews: taskReviews,
    approvals: taskApprovals,
    evidence: taskEvidence,
    policyDecisions: taskPolicies,
    executions: taskExecutions,
    timeline: sortTimeline(derived.filter((entry) => entry.occurredAt)),
  };
}
