"use strict";

/**
 * Authority boundary checks for Control Plane contracts v0.5.
 * Fail closed: executor/Claude/Markdown cannot become human authority.
 * Human approval remains GitHub PR review APPROVED (approval-provenance v0.4).
 * These checks do not grant authority.
 */

const ROLES = ["orchestrator", "executor", "reviewer", "human_authority"];

const ALLOWED_HANDOFF_PAIRS = {
  task_contract: [["orchestrator", "executor"]],
  execution_handoff: [["executor", "reviewer"]],
  review_handoff: [["reviewer", "human_authority"]],
};

const AUTHORITATIVE_CLAIMS = new Set([
  "human",
  "human_approval",
  "human_authority",
  "github_human_approval",
  "authoritative",
  "approved",
  "APPROVED",
]);

const MARKDOWN_AUTHORITY_SOURCES = new Set([
  "markdown",
  "markdown_file",
  "markdown_approval",
  "repository_markdown",
  "approval_artifact_markdown",
  "control-plane/approvals",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function authorityErrors(kind, doc) {
  const errors = [];
  if (!isObject(doc)) {
    return ["document missing"];
  }

  const claim = doc.authority_claim;
  if (claim !== undefined && claim !== "none") {
    errors.push(`authority_claim ${JSON.stringify(claim)} is not allowed`);
  }

  if (doc.claimed_authority && AUTHORITATIVE_CLAIMS.has(doc.claimed_authority)) {
    errors.push("claimed_authority cannot be human/GitHub authority");
  }

  const sourceRole = doc.source_role;
  if (
    (sourceRole === "executor" || sourceRole === "reviewer" || sourceRole === "orchestrator") &&
    AUTHORITATIVE_CLAIMS.has(claim)
  ) {
    errors.push(`${sourceRole} cannot claim human authority`);
  }

  if (sourceRole === "executor" && AUTHORITATIVE_CLAIMS.has(doc.claimed_authority)) {
    errors.push("executor claiming human authority");
  }

  if (
    sourceRole === "reviewer" &&
    (AUTHORITATIVE_CLAIMS.has(doc.claimed_authority) || AUTHORITATIVE_CLAIMS.has(claim))
  ) {
    errors.push("Claude/reviewer claiming human authority");
  }

  if (doc.verdict_kind === "claude_advisory" && AUTHORITATIVE_CLAIMS.has(claim)) {
    errors.push("Claude claiming human authority");
  }

  if (
    doc.verdict_kind === "claude_advisory" &&
    (doc.claimed_authority && AUTHORITATIVE_CLAIMS.has(doc.claimed_authority))
  ) {
    errors.push("Claude claiming human authority");
  }

  if (kind === "review_handoff" && doc.verdict_kind === "claude_advisory") {
    if (doc.authority_rank && doc.authority_rank !== "advisory") {
      errors.push("Claude review must remain advisory");
    }
  }

  const authoritySource = doc.authority_source;
  if (authoritySource && MARKDOWN_AUTHORITY_SOURCES.has(authoritySource)) {
    errors.push("Markdown approval as authority");
  }

  if (doc.markdown_approval === true || doc.approval_via === "markdown") {
    errors.push("Markdown approval as authority");
  }

  if (kind === "human_approval_gate") {
    if (authoritySource && authoritySource !== "github_pr_review") {
      errors.push("human approval gate authority_source must be github_pr_review");
    }
    if (doc.substitutes_for_github_review === true) {
      errors.push("human approval gate cannot substitute for live GitHub review");
    }
    if (doc.live_verification_required === false) {
      errors.push("human approval gate requires live GitHub verification");
    }
    if (doc.record_role && doc.record_role !== "derived_record_not_authority") {
      errors.push("human approval gate is a derived record, not authority");
    }
  }

  if (doc.evidence_as_authority === true) {
    errors.push("evidence cannot be used as authoritative input");
  }

  if (doc.input_role && doc.input_role !== "reference_only") {
    errors.push("evidence/policy references cannot be authoritative input");
  }

  if (doc.authority_rank === "authoritative" && kind !== "human_approval_gate") {
    errors.push("document cannot declare authoritative rank");
  }

  if (kind === "human_approval_gate" && doc.authority_rank === "authoritative") {
    errors.push("human approval gate document is not itself authoritative");
  }

  return errors;
}

function roleErrors(kind, doc) {
  const errors = [];
  if (!isObject(doc)) {
    return ["document missing"];
  }

  const pairs = ALLOWED_HANDOFF_PAIRS[kind];
  if (!pairs) {
    return errors;
  }

  if (!doc.source_role) {
    errors.push("missing source_role");
  } else if (!ROLES.includes(doc.source_role)) {
    errors.push(`invalid source_role: ${doc.source_role}`);
  }

  if (!doc.target_role) {
    errors.push("missing target_role");
  } else if (!ROLES.includes(doc.target_role)) {
    errors.push(`invalid target_role: ${doc.target_role}`);
  }

  if (doc.source_role && doc.target_role) {
    const ok = pairs.some(
      ([source, target]) => source === doc.source_role && target === doc.target_role
    );
    if (!ok) {
      errors.push(
        `invalid source/target role pair for ${kind}: ${doc.source_role} -> ${doc.target_role}`
      );
    }
  }

  return errors;
}

module.exports = {
  ROLES,
  ALLOWED_HANDOFF_PAIRS,
  AUTHORITATIVE_CLAIMS,
  authorityErrors,
  roleErrors,
};
