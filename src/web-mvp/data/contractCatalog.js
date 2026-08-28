"use strict";

/**
 * Raw Contracts v0.5 mock bundles for the read-only Web MVP.
 * Validation and authority labeling happen in the contract adapter.
 * These objects are not authority. Placeholder hashes are internally consistent;
 * Node tests stamp a real binding via contracts v0.5 before asserting.
 */

const HASH = "0000000000000000000000000000000000000000000000000000000000000000";
const BASE_SHA = "f64b688d9f28e7f159a473f6df961bcc219a65a2";
const HEAD_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const MISMATCH_SHA = "cccccccccccccccccccccccccccccccccccccccc";

const SCOPE = {
  allowed_path_globs: [
    ".github/*",
    "control-plane/*",
    "src/*",
    "README.md",
    ".gitignore",
  ],
  denied_targets: [
    "vps",
    "production",
    "jetro",
    "ibe",
    "database",
    "scheduler",
    "automatic_agent",
    "http_api",
    "github_integration_runtime",
    "merge",
  ],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeTask(taskId, overrides = {}) {
  return {
    schema_version: "0.5",
    document_kind: "task_contract",
    mission_id: "MISSION-20260828-001",
    task_id: taskId,
    contract_id: "CONTRACT-20260828-001",
    contract_hash: HASH,
    execution_id: "EXEC-20260828-001",
    state: "REVIEW_READY",
    base_sha: BASE_SHA,
    scope_boundaries: SCOPE,
    acceptance_criteria: [
      "Web MVP consumes Contracts v0.5 without becoming an authority source",
    ],
    assigned_to: { kind: "agent", identity: "cursor", role: "executor" },
    source_role: "orchestrator",
    target_role: "executor",
    policy_refs: [
      {
        policy_version: "approval-provenance-v0.4",
        check_name: "approval-provenance",
      },
    ],
    evidence_refs: [
      {
        evidence_id: "EVD-20260828-001",
        kind: "markdown",
        path: "control-plane/evidence/WEB_MVP_CONTRACT_INTEGRATION_V06.md",
        authority_rank: "non-authoritative",
        input_role: "reference_only",
      },
    ],
    authority_claim: "none",
    ...overrides,
  };
}

function makeMission() {
  return {
    schema_version: "0.5",
    mission_id: "MISSION-20260828-001",
    title: "Web MVP contract integration v0.6",
    description:
      "Read-only Web Control Plane consumes canonical Task/Handoff contracts v0.5.",
    state: "IN_PROGRESS",
    base_sha: BASE_SHA,
    scope_boundaries: SCOPE,
    acceptance_criteria: ["UI remains read-only and non-authoritative"],
    task_ids: [
      "TASK-20260828-001",
      "TASK-20260828-002",
      "TASK-20260828-003",
      "TASK-20260828-004",
      "TASK-20260828-005",
      "TASK-20260828-006",
    ],
    authority_claim: "none",
  };
}

function makeAssignment(taskId) {
  return {
    schema_version: "0.5",
    mission_id: "MISSION-20260828-001",
    task_id: taskId,
    contract_id: "CONTRACT-20260828-001",
    assigned_to: { kind: "agent", identity: "cursor", role: "executor" },
    assigned_at: "2026-08-28T18:00:00Z",
    authority_claim: "none",
  };
}

function makeExecution(taskId) {
  return {
    schema_version: "0.5",
    mission_id: "MISSION-20260828-001",
    task_id: taskId,
    contract_id: "CONTRACT-20260828-001",
    execution_id: "EXEC-20260828-001",
    state: "RESULT_SUBMITTED",
    assigned_to: { kind: "agent", identity: "cursor", role: "executor" },
    base_sha: BASE_SHA,
    lease_token: "opaque-lease-token-01",
    leased_at: "2026-08-28T18:00:00Z",
    lease_ttl_seconds: 3600,
    heartbeat_at: "2026-08-28T18:20:00Z",
    outcome: "SUCCESS",
    pr_number: 21,
    head_sha: HEAD_SHA,
    authority_claim: "none",
  };
}

function makeHandoff(taskId, overrides = {}) {
  return {
    schema_version: "0.5",
    document_kind: "execution_handoff",
    mission_id: "MISSION-20260828-001",
    task_id: taskId,
    contract_id: "CONTRACT-20260828-001",
    contract_hash: HASH,
    execution_id: "EXEC-20260828-001",
    outcome: "SUCCESS",
    base_sha: BASE_SHA,
    pr_number: 21,
    head_sha: HEAD_SHA,
    files_changed: ["src/web-mvp/adapter/contractAdapter.js"],
    source_role: "executor",
    target_role: "reviewer",
    self_reported_summary: "Informational executor handoff. Not authority.",
    summary_role: "informational_only",
    authority_claim: "none",
    ...overrides,
  };
}

function makeReview(taskId, overrides = {}) {
  return {
    schema_version: "0.5",
    document_kind: "review_handoff",
    mission_id: "MISSION-20260828-001",
    task_id: taskId,
    contract_id: "CONTRACT-20260828-001",
    contract_hash: HASH,
    execution_id: "EXEC-20260828-001",
    review_id: "REVIEW-20260828-001",
    state: "PUBLISHED",
    verdict_kind: "claude_advisory",
    verdict: "PASS_WITH_QUALIFICATIONS",
    reviewed_head_sha: HEAD_SHA,
    pr_number: 21,
    source_role: "reviewer",
    target_role: "human_authority",
    authority_rank: "advisory",
    reviewer: { kind: "agent", identity: "claude", role: "reviewer" },
    authority_claim: "none",
    ...overrides,
  };
}

function makeGate(taskId, overrides = {}) {
  return {
    schema_version: "0.5",
    document_kind: "human_approval_gate",
    mission_id: "MISSION-20260828-001",
    task_id: taskId,
    contract_id: "CONTRACT-20260828-001",
    contract_hash: HASH,
    pr_number: 21,
    reviewed_head_sha: HEAD_SHA,
    github_review_state: "APPROVED",
    reviewer_identity: "machubsystem-sketch",
    authority_source: "github_pr_review",
    policy_ref: {
      policy_version: "approval-provenance-v0.4",
      check_name: "approval-provenance",
    },
    live_verification_required: true,
    substitutes_for_github_review: false,
    record_role: "derived_record_not_authority",
    authority_claim: "none",
    ...overrides,
  };
}

function makeEvidence(taskId) {
  return {
    schema_version: "0.5",
    document_kind: "evidence_reference",
    mission_id: "MISSION-20260828-001",
    task_id: taskId,
    contract_id: "CONTRACT-20260828-001",
    contract_hash: HASH,
    evidence_id: "EVD-20260828-001",
    kind: "markdown",
    path: "control-plane/evidence/WEB_MVP_CONTRACT_INTEGRATION_V06.md",
    summary: "Markdown evidence. Reference only. Not authorization.",
    authority_rank: "non-authoritative",
    input_role: "reference_only",
    authority_claim: "none",
  };
}

function makePolicy(taskId) {
  return {
    schema_version: "0.5",
    document_kind: "policy_check_reference",
    mission_id: "MISSION-20260828-001",
    task_id: taskId,
    contract_id: "CONTRACT-20260828-001",
    contract_hash: HASH,
    policy_version: "approval-provenance-v0.4",
    check_name: "approval-provenance",
    conclusion: "neutral",
    input_role: "reference_only",
    authority_claim: "none",
  };
}

function fullBundle(taskId, objective, tweaks = {}) {
  const bundle = {
    mission: makeMission(),
    task: makeTask(taskId, { acceptance_criteria: [objective] }),
    assignment: makeAssignment(taskId),
    execution: makeExecution(taskId),
    execution_handoff: makeHandoff(taskId),
    review_handoff: makeReview(taskId),
    approval_gate: makeGate(taskId),
    evidence: makeEvidence(taskId),
    policy: makePolicy(taskId),
  };
  if (tweaks.task) Object.assign(bundle.task, tweaks.task);
  if (tweaks.review_handoff) Object.assign(bundle.review_handoff, tweaks.review_handoff);
  if (tweaks.approval_gate) Object.assign(bundle.approval_gate, tweaks.approval_gate);
  if (tweaks.execution_handoff) Object.assign(bundle.execution_handoff, tweaks.execution_handoff);
  if (tweaks.deleteTaskId) delete bundle.task.task_id;
  return bundle;
}

export const CONTRACT_SCENARIOS = [
  {
    id: "TASK-20260828-001",
    scenario: "valid-chain",
    title: "Valid handoff chain",
    objective: "Valid Contracts v0.5 handoff chain projected read-only.",
    bundle: fullBundle(
      "TASK-20260828-001",
      "Valid Contracts v0.5 handoff chain projected read-only.",
    ),
  },
  {
    id: "TASK-20260828-002",
    scenario: "claude-advisory",
    title: "Claude advisory review",
    objective: "Claude review must remain advisory and never human approval.",
    bundle: fullBundle(
      "TASK-20260828-002",
      "Claude review must remain advisory and never human approval.",
      {
        review_handoff: {
          verdict: "PASS",
          reviewer: { kind: "agent", identity: "claude", role: "reviewer" },
        },
      },
    ),
  },
  {
    id: "TASK-20260828-003",
    scenario: "gate-live-verification",
    title: "Approval gate awaiting live GitHub verification",
    objective: "Human approval gate is a derived record; live GitHub verification is required.",
    bundle: fullBundle(
      "TASK-20260828-003",
      "Human approval gate is a derived record; live GitHub verification is required.",
    ),
  },
  {
    id: "TASK-20260828-004",
    scenario: "head-sha-mismatch",
    title: "Head SHA mismatch",
    objective: "Mismatched reviewed head SHAs must fail closed.",
    bundle: fullBundle(
      "TASK-20260828-004",
      "Mismatched reviewed head SHAs must fail closed.",
      { approval_gate: { reviewed_head_sha: MISMATCH_SHA } },
    ),
  },
  {
    id: "TASK-20260828-005",
    scenario: "identity-collision",
    title: "Executor/reviewer identity collision",
    objective: "Executor identity must not appear as reviewer, even with role spoofing.",
    bundle: fullBundle(
      "TASK-20260828-005",
      "Executor identity must not appear as reviewer, even with role spoofing.",
      {
        review_handoff: {
          reviewer: { kind: "agent", identity: "cursor", role: "reviewer" },
        },
      },
    ),
  },
  {
    id: "TASK-20260828-006",
    scenario: "invalid-schema",
    title: "Invalid task contract",
    objective: "Missing task id must fail closed and never render as PASS.",
    bundle: fullBundle(
      "TASK-20260828-006",
      "Missing task id must fail closed and never render as PASS.",
      { deleteTaskId: true },
    ),
  },
];

export function getScenario(id) {
  return CONTRACT_SCENARIOS.find((item) => item.id === id) ?? null;
}

export { clone, HASH, BASE_SHA, HEAD_SHA, MISMATCH_SHA };
