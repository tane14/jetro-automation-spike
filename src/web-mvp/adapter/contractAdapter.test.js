import { createRequire } from "node:module";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONTRACT_SCENARIOS, getScenario } from "../data/contractCatalog.js";
import { adaptContractBundle } from "./contractAdapter.js";
import { projectContractView, NOT_AUTHORITY, RANK_DISPLAY } from "./projectContractView.js";

const require = createRequire(import.meta.url);
const contracts = require("../../contracts/index.js");

function stampBundle(bundle) {
  const copy = JSON.parse(JSON.stringify(bundle));
  if (copy.task) {
    copy.task = contracts.stampContractHash(copy.task);
    const hash = copy.task.contract_hash;
    for (const key of [
      "execution_handoff",
      "review_handoff",
      "approval_gate",
      "evidence",
      "policy",
    ]) {
      if (copy[key] && Object.prototype.hasOwnProperty.call(copy[key], "contract_hash")) {
        copy[key].contract_hash = hash;
      }
    }
  }
  return copy;
}

function adaptWithFullContracts(entry) {
  const bundle = stampBundle(entry.bundle);
  const documentResults = {};
  const map = [
    ["mission", "mission"],
    ["task", "task_contract"],
    ["assignment", "agent_assignment"],
    ["execution", "execution"],
    ["execution_handoff", "execution_handoff"],
    ["review_handoff", "review_handoff"],
    ["approval_gate", "human_approval_gate"],
    ["evidence", "evidence_reference"],
    ["policy", "policy_check_reference"],
  ];
  for (const [key, kind] of map) {
    if (bundle[key]) {
      documentResults[key] = contracts.validateDocument(kind, bundle[key]);
    }
  }
  const chain = contracts.validateHandoffChain(bundle);
  const correlation = contracts.validateCorrelation(bundle);
  return projectContractView({
    entry,
    bundle,
    documentResults,
    chain,
    correlation,
  });
}

describe("valid contract renders correctly", () => {
  it("projects task id, mission, contract version, and chain as valid", () => {
    const view = adaptWithFullContracts(getScenario("TASK-20260828-001"));
    assert.equal(view.chainConsistency, "valid");
    assert.equal(view.taskId, "TASK-20260828-001");
    assert.equal(view.missionId, "MISSION-20260828-001");
    assert.equal(view.schemaVersion, "0.5");
    assert.equal(view.contractId, "CONTRACT-20260828-001");
    assert.equal(view.assignedAgent.id, "cursor");
    assert.equal(view.lifecycleState, "REVIEW_READY");
    assert.equal(view.handoffChain.length, 7);
    assert.equal(view.riskTier, null);
  });
});

describe("invalid contract fails closed", () => {
  it("does not convert a missing task id into PASS or approval", () => {
    const view = adaptWithFullContracts(getScenario("TASK-20260828-006"));
    assert.equal(view.chainConsistency, "invalid");
    assert.notEqual(view.approvalStatus, "approved");
    assert.ok(view.consistencyErrors.some((err) => err.includes("task_id")));
    assert.equal(view.sufficientForAuthority, false);
  });
});

describe("Claude advisory is never rendered as human approval", () => {
  it("labels claude_advisory as ADVISORY", () => {
    const view = adaptWithFullContracts(getScenario("TASK-20260828-002"));
    const review = view.handoffChain.find((step) => step.key === "review_handoff");
    assert.equal(review.rank, "advisory");
    assert.equal(review.rankDisplay, "ADVISORY");
    assert.notEqual(review.rank, "authoritative");
    assert.equal(view.reviewKind, "claude_review");
    assert.match(view.reviewStatus, /claude_advisory/);
    assert.notEqual(view.humanApprovalStatus, "approved");
  });
});

describe("Markdown cannot become authority", () => {
  it("keeps markdown evidence off the authoritative rank", () => {
    const view = adaptWithFullContracts(getScenario("TASK-20260828-001"));
    const evidence = view.handoffChain.find((step) => step.key === "evidence");
    assert.equal(evidence.rank, "reference-only");
    assert.equal(evidence.rankDisplay, "REFERENCE ONLY");
    assert.notEqual(evidence.rank, "authoritative");
    for (const ref of view.evidenceRefs) {
      assert.equal(ref.input_role, "reference_only");
      assert.notEqual(ref.authority_rank, "authoritative");
    }
  });
});

describe("Evidence remains reference-only", () => {
  it("marks evidence input_role as reference_only", () => {
    const view = adaptWithFullContracts(getScenario("TASK-20260828-001"));
    assert.equal(view.evidenceKind, "evidence_reference");
    const evidence = view.handoffChain.find((step) => step.key === "evidence");
    assert.equal(evidence.rankDisplay, "REFERENCE ONLY");
    assert.equal(view.bundle.evidence.input_role, "reference_only");
    assert.equal(view.bundle.evidence.authority_claim, "none");
  });
});

describe("human approval gate requires live GitHub verification", () => {
  it("never treats the gate JSON as live approval", () => {
    const view = adaptWithFullContracts(getScenario("TASK-20260828-003"));
    const gate = view.handoffChain.find((step) => step.key === "approval_gate");
    assert.equal(gate.rank, "live-verification-required");
    assert.equal(gate.rankDisplay, "LIVE VERIFICATION REQUIRED");
    assert.match(gate.summary, /LIVE GITHUB VERIFICATION REQUIRED/);
    assert.equal(view.humanApprovalStatus, "live_github_verification_required");
    assert.equal(view.requiresLiveGithubApproval, true);
    assert.notEqual(gate.rank, "authoritative");
  });
});

describe("sufficient_for_authority false is respected", () => {
  it("stays false for valid and invalid chains", () => {
    for (const entry of CONTRACT_SCENARIOS) {
      const view = adaptWithFullContracts(entry);
      assert.equal(view.sufficientForAuthority, false);
      assert.equal(view.requiresLiveGithubApproval, true);
      assert.equal(view.rawChain.sufficient_for_authority, false);
      assert.equal(NOT_AUTHORITY.sufficient_for_authority, false);
    }
  });
});

describe("head SHA mismatch becomes invalid/inconsistent state", () => {
  it("fails closed and does not assume approval", () => {
    const view = adaptWithFullContracts(getScenario("TASK-20260828-004"));
    assert.equal(view.chainConsistency, "invalid");
    assert.ok(
      view.consistencyErrors.some((err) => err.includes("reviewed head SHA mismatch")),
    );
    assert.equal(view.approvalStatus, "invalid");
    assert.equal(view.sufficientForAuthority, false);
  });
});

describe("executor/reviewer identity collision fails", () => {
  it("rejects reviewer identity matching the executor even when role is reviewer", () => {
    const view = adaptWithFullContracts(getScenario("TASK-20260828-005"));
    assert.equal(view.chainConsistency, "invalid");
    assert.ok(
      view.consistencyErrors.some((err) =>
        err.includes("reviewer identity is the executor"),
      ),
    );
  });
});

describe("valid handoff chain renders correctly", () => {
  it("includes the required chain steps without granting authority", () => {
    const view = adaptWithFullContracts(getScenario("TASK-20260828-001"));
    assert.equal(view.chainConsistency, "valid");
    assert.deepEqual(
      view.handoffChain.map((step) => step.key),
      [
        "task",
        "assignment",
        "execution",
        "execution_handoff",
        "review_handoff",
        "approval_gate",
        "evidence",
      ],
    );
    assert.equal(RANK_DISPLAY.advisory, "ADVISORY");
    assert.equal(view.sufficientForAuthority, false);
  });
});

describe("lite adapter agrees with full contracts on fail-closed outcomes", () => {
  it("matches consistency for every mock scenario", () => {
    for (const entry of CONTRACT_SCENARIOS) {
      const full = adaptWithFullContracts(entry);
      const lite = adaptContractBundle(entry);
      assert.equal(
        lite.chainConsistency,
        full.chainConsistency,
        entry.id + " " + lite.consistencyErrors.join("; ") + " vs " + full.consistencyErrors.join("; "),
      );
      assert.equal(lite.sufficientForAuthority, false);
      assert.equal(full.sufficientForAuthority, false);
    }
  });
});
