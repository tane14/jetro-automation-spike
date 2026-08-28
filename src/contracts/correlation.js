"use strict";

/**
 * Cross-document correlation rules for Control Plane contracts v0.5.
 *
 * These rules are intentionally NOT fully JSON-Schema-enforceable (inequality
 * across documents, one-active-lease across a set of executions). JSON Schema
 * still encodes types, ids, enums, and published-review reviewed_head_sha.
 *
 * None of these checks grant authority. GitHub PR review APPROVED from an
 * allowed human remains the approval authority (approval provenance v0.4).
 */

function identityKey(actor) {
  if (!actor || typeof actor !== "object") return null;
  if (typeof actor.identity !== "string") return null;
  return actor.identity.toLowerCase();
}

function collectExecutorIdentities(bundle) {
  const found = [];
  const sources = [
    bundle.task && bundle.task.assigned_to,
    bundle.assignment && bundle.assignment.assigned_to,
    bundle.execution && bundle.execution.assigned_to,
  ];
  for (const actor of sources) {
    if (actor && actor.role === "executor") {
      const key = identityKey(actor);
      if (key) found.push(key);
    }
  }
  return found;
}

function validateCorrelation(bundle) {
  const errors = [];
  if (!bundle || typeof bundle !== "object") {
    return {
      valid: false,
      errors: ["bundle must be an object"],
      sufficient_for_authority: false,
      requires_live_github_approval: true,
    };
  }

  const docs = [
    "mission",
    "task",
    "assignment",
    "execution",
    "handoff",
    "execution_handoff",
    "review",
    "review_handoff",
    "approval_gate",
  ]
    .map((key) => bundle[key])
    .filter(Boolean);

  const fields = ["mission_id", "task_id", "contract_id"];
  for (const field of fields) {
    const values = new Set(docs.map((doc) => doc[field]).filter(Boolean));
    if (values.size > 1) {
      errors.push(`correlation mismatch for ${field}: ${[...values].join(", ")}`);
    }
  }

  const hashes = new Set(docs.map((doc) => doc.contract_hash).filter(Boolean));
  if (hashes.size > 1) {
    errors.push("correlation mismatch for contract_hash binding");
  }

  const executionHandoff = bundle.execution_handoff || bundle.handoff;
  const reviewHandoff = bundle.review_handoff || bundle.review;

  if (bundle.execution && executionHandoff) {
    if (bundle.execution.execution_id !== executionHandoff.execution_id) {
      errors.push("handoff.execution_id must equal execution.execution_id");
    }
  }

  if (bundle.execution && reviewHandoff && reviewHandoff.execution_id) {
    if (bundle.execution.execution_id !== reviewHandoff.execution_id) {
      errors.push("review.execution_id must equal execution.execution_id");
    }
  }

  const headValues = [
    executionHandoff && executionHandoff.head_sha,
    reviewHandoff && reviewHandoff.reviewed_head_sha,
    bundle.approval_gate && bundle.approval_gate.reviewed_head_sha,
  ].filter(Boolean);
  if (new Set(headValues).size > 1) {
    errors.push(
      "reviewed head SHA mismatch across execution_handoff.head_sha, review_handoff.reviewed_head_sha, and human_approval_gate.reviewed_head_sha"
    );
  }

  const executors = collectExecutorIdentities(bundle);
  const approver = reviewHandoff && identityKey(reviewHandoff.github_approver);
  const reviewer = reviewHandoff && identityKey(reviewHandoff.reviewer);
  const gateApprover =
    bundle.approval_gate &&
    identityKey({ identity: bundle.approval_gate.reviewer_identity });

  if (approver && executors.includes(approver)) {
    errors.push(
      "executor cannot self-approve: assigned_to identity matches github_approver"
    );
  }

  if (gateApprover && executors.includes(gateApprover)) {
    errors.push(
      "executor cannot self-approve: assigned_to identity matches approval gate reviewer"
    );
  }

  if (reviewer && executors.includes(reviewer)) {
    errors.push(
      "executor cannot self-approve: reviewer identity is the executor"
    );
  }

  if (Array.isArray(bundle.executions)) {
    const active = bundle.executions.filter(
      (item) => item && (item.state === "LEASED" || item.state === "RUNNING")
    );
    if (active.length > 1) {
      errors.push("a task may have only one active lease");
    }
    const tokens = active.map((item) => item.lease_token).filter(Boolean);
    if (new Set(tokens).size !== tokens.length) {
      errors.push("duplicate lease_token across executions");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    sufficient_for_authority: false,
    requires_live_github_approval: true,
  };
}

module.exports = { validateCorrelation };
