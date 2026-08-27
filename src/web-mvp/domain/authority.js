/**
 * Authority labeling for the read-only Web Control Plane MVP.
 *
 * GitHub remains the system of record. This module only labels existing facts.
 * It MUST NOT treat Claude review or Markdown evidence as human approval.
 */

/** @typedef {"github_human_approval" | "claude_review" | "markdown_evidence"} AuthorityKind */
/** @typedef {"authoritative" | "advisory" | "non-authoritative"} AuthorityRank */

/** @type {Record<AuthorityKind, { label: string, rank: AuthorityRank }>} */
export const AUTHORITY_LABELS = {
  github_human_approval: {
    label: "GitHub human approval",
    rank: "authoritative",
  },
  claude_review: {
    label: "Claude review",
    rank: "advisory",
  },
  markdown_evidence: {
    label: "Markdown evidence",
    rank: "non-authoritative",
  },
};

/**
 * @param {AuthorityKind} kind
 * @returns {{ kind: AuthorityKind, label: string, rank: AuthorityRank }}
 */
export function labelAuthority(kind) {
  const entry = AUTHORITY_LABELS[kind];
  if (!entry) {
    throw new Error(`Unknown authority kind: ${kind}`);
  }
  return { kind, label: entry.label, rank: entry.rank };
}

/**
 * @param {AuthorityKind} kind
 * @returns {boolean}
 */
export function isAuthoritative(kind) {
  return kind === "github_human_approval";
}

/**
 * @param {{ kind: string }} review
 * @returns {AuthorityKind}
 */
export function authorityForReview(review) {
  if (review.kind === "github_human") {
    return "github_human_approval";
  }
  if (review.kind === "claude") {
    return "claude_review";
  }
  throw new Error(`Unknown review kind: ${review.kind}`);
}

/**
 * Markdown artifacts are derived evidence. They never confer approval authority.
 * @param {{ kind?: string }} _evidence
 * @returns {AuthorityKind}
 */
export function authorityForEvidence(_evidence) {
  return "markdown_evidence";
}

/**
 * @param {{ authorityKind: AuthorityKind }} approval
 * @returns {AuthorityKind}
 */
export function authorityForApproval(approval) {
  return approval.authorityKind;
}
