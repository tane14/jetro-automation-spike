import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AUTHORITY_LABELS,
  authorityForEvidence,
  authorityForReview,
  isAuthoritative,
  labelAuthority,
} from "./authority.js";

describe("authority labeling", () => {
  it("labels GitHub human approval as authoritative", () => {
    const labeled = labelAuthority("github_human_approval");
    assert.equal(labeled.label, "GitHub human approval");
    assert.equal(labeled.rank, "authoritative");
    assert.equal(isAuthoritative(labeled.kind), true);
  });

  it("never labels Claude review as GitHub human approval", () => {
    const kind = authorityForReview({ kind: "claude" });
    const labeled = labelAuthority(kind);

    assert.equal(kind, "claude_review");
    assert.equal(labeled.label, "Claude review");
    assert.equal(labeled.rank, "advisory");
    assert.notEqual(labeled.label, "GitHub human approval");
    assert.notEqual(labeled.rank, "authoritative");
    assert.equal(isAuthoritative(kind), false);
    assert.notEqual(
      AUTHORITY_LABELS.claude_review.label,
      AUTHORITY_LABELS.github_human_approval.label,
    );
  });

  it("never labels Markdown evidence as GitHub human approval", () => {
    const kind = authorityForEvidence({ kind: "markdown" });
    const labeled = labelAuthority(kind);

    assert.equal(kind, "markdown_evidence");
    assert.equal(labeled.label, "Markdown evidence");
    assert.equal(labeled.rank, "non-authoritative");
    assert.notEqual(labeled.label, "GitHub human approval");
    assert.notEqual(labeled.rank, "authoritative");
    assert.equal(isAuthoritative(kind), false);
    assert.notEqual(
      AUTHORITY_LABELS.markdown_evidence.label,
      AUTHORITY_LABELS.github_human_approval.label,
    );
  });

  it("would fail if Claude or Markdown shared the GitHub human approval label", () => {
    const github = labelAuthority("github_human_approval");
    const claude = labelAuthority("claude_review");
    const markdown = labelAuthority("markdown_evidence");
    const ranks = new Set([github.rank, claude.rank, markdown.rank]);

    assert.equal(ranks.size, 3);
    assert.notEqual(claude.label, github.label);
    assert.notEqual(markdown.label, github.label);
    assert.notEqual(claude.rank, github.rank);
    assert.notEqual(markdown.rank, github.rank);
  });

  it("labels evidence references as reference-only", () => {
    const kind = authorityForEvidence({ input_role: "reference_only" });
    const labeled = labelAuthority(kind);
    assert.equal(kind, "evidence_reference");
    assert.equal(labeled.rank, "reference-only");
    assert.equal(labeled.displayRank, "REFERENCE ONLY");
    assert.equal(isAuthoritative(kind), false);
  });

  it("labels human approval gate as live verification required, not authoritative", () => {
    const labeled = labelAuthority("human_approval_gate");
    assert.equal(labeled.rank, "live-verification-required");
    assert.equal(labeled.displayRank, "LIVE VERIFICATION REQUIRED");
    assert.equal(isAuthoritative("human_approval_gate"), false);
    assert.notEqual(labeled.rank, "authoritative");
  });
});
