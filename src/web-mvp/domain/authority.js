/**
 * Authority labeling for the read-only Web Control Plane MVP.
 *
 * GitHub remains the system of record. This module only labels existing facts.
 * It MUST NOT treat Claude review, Markdown evidence, contract JSON, or a
 * human_approval_gate record as live human approval.
 */

/** @typedef {"github_human_approval" | "claude_review" | "markdown_evidence" | "evidence_reference" | "human_approval_gate" | "contract_record"} AuthorityKind */
/** @typedef {"authoritative" | "advisory" | "non-authoritative" | "reference-only" | "live-verification-required"} AuthorityRank */

/** @type {Record<AuthorityKind, { label: string, rank: AuthorityRank, displayRank: string }>} */
export const AUTHORITY_LABELS = {
  github_human_approval: {
    label: "GitHub human approval",
    rank: "authoritative",
    displayRank: "AUTHORITATIVE",
  },
  claude_review: {
    label: "Claude review",
    rank: "advisory",
    displayRank: "ADVISORY",
  },
  markdown_evidence: {
    label: "Markdown evidence",
    rank: "non-authoritative",
    displayRank: "NON-AUTHORITATIVE",
  },
  evidence_reference: {
    label: "Evidence reference",
    rank: "reference-only",
    displayRank: "REFERENCE ONLY",
  },
  human_approval_gate: {
    label: "Human approval gate",
    rank: "live-verification-required",
    displayRank: "LIVE VERIFICATION REQUIRED",
  },
  contract_record: {
    label: "Contract record",
    rank: "non-authoritative",
    displayRank: "NON-AUTHORITATIVE",
  },
};

/**
 * @param {AuthorityKind} kind
 * @returns {{ kind: AuthorityKind, label: string, rank: AuthorityRank, displayRank: string }}
 */
export function labelAuthority(kind) {
  const entry = AUTHORITY_LABELS[kind];
  if (!entry) {
    throw new Error(`Unknown authority kind: ${kind}`);
  }
  return { kind, label: entry.label, rank: entry.rank, displayRank: entry.displayRank };
}

/**
 * @param {AuthorityKind} kind
 * @returns {boolean}
 */
export function isAuthoritative(kind) {
  return kind === "github_human_approval";
}

/**
 * @param {{ kind?: string, verdict_kind?: string }} review
 * @returns {AuthorityKind}
 */
export function authorityForReview(review) {
  if (review.kind === "github_human") {
    return "github_human_approval";
  }
  if (review.kind === "claude" || review.verdict_kind === "claude_advisory") {
    return "claude_review";
  }
  if (review.verdict_kind === "github_approval_record") {
    return "human_approval_gate";
  }
  throw new Error(`Unknown review kind: ${review.kind || review.verdict_kind}`);
}

/**
 * Markdown artifacts and evidence refs are never approval authority.
 * @param {{ kind?: string, input_role?: string }} evidence
 * @returns {AuthorityKind}
 */
export function authorityForEvidence(evidence) {
  if (evidence && evidence.input_role === "reference_only") {
    return "evidence_reference";
  }
  return "markdown_evidence";
}

/**
 * A human_approval_gate JSON record is not live GitHub approval.
 * @returns {AuthorityKind}
 */
export function authorityForApprovalGate() {
  return "human_approval_gate";
}

/**
 * @param {{ authorityKind: AuthorityKind }} approval
 * @returns {AuthorityKind}
 */
export function authorityForApproval(approval) {
  if (approval.authorityKind === "github_human_approval") {
    return "human_approval_gate";
  }
  return approval.authorityKind;
}
