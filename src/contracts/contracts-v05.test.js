"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  validate,
  validateDocument,
  validateHandoffChain,
  validateCorrelation,
  stampContractHash,
  computeContractHash,
  canonicalJson,
  validateTransition,
} = require("./index");

const ROOT = path.resolve(__dirname, "..", "..");
const V05 = path.join(ROOT, "control-plane", "contracts", "v0.5");
const FIXTURES = path.join(V05, "fixtures");

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function schema(name) {
  return loadJson(path.join(V05, name));
}

function fixture(name) {
  return loadJson(path.join(FIXTURES, name));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function boundTask() {
  return stampContractHash(fixture("valid-task.json"));
}

function withTaskHash(doc, task) {
  const copy = clone(doc);
  copy.contract_hash = task.contract_hash;
  return copy;
}

function validChain() {
  const task = boundTask();
  return {
    task,
    execution_handoff: withTaskHash(fixture("valid-handoff.json"), task),
    review_handoff: withTaskHash(fixture("valid-review.json"), task),
    approval_gate: withTaskHash(fixture("valid-approval-gate.json"), task),
    evidence: withTaskHash(fixture("valid-evidence.json"), task),
    policy: withTaskHash(fixture("valid-policy.json"), task),
  };
}

const laboratoryScope = {
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

test("valid Task Contract", () => {
  const raw = fixture("valid-task.json");
  const rawResult = validateDocument("task_contract", raw);
  assert.equal(rawResult.valid, true, rawResult.errors.join("; "));

  const task = boundTask();
  const result = validateDocument("task_contract", task);
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.equal(task.contract_hash, raw.contract_hash);
  assert.equal(task.task_id, "TASK-20260828-001");
  assert.equal(task.schema_version, "0.5");
  assert.equal(task.authority_claim, "none");
});

test("missing task id", () => {
  const task = boundTask();
  delete task.task_id;
  const result = validateDocument("task_contract", task);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((err) => err.includes("task_id")),
    result.errors.join("; ")
  );
});

test("invalid contract version", () => {
  const task = boundTask();
  task.schema_version = "0.4";
  const result = validateDocument("task_contract", task);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((err) => err.includes("0.5") || err.includes("schema_version")),
    result.errors.join("; ")
  );
});

test("invalid source/target role", () => {
  const handoff = withTaskHash(fixture("valid-handoff.json"), boundTask());
  handoff.source_role = "human_authority";
  handoff.target_role = "executor";
  const result = validateDocument("execution_handoff", handoff);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((err) => err.includes("source") || err.includes("target")),
    result.errors.join("; ")
  );

  const unknown = withTaskHash(fixture("valid-handoff.json"), boundTask());
  unknown.source_role = "not_a_role";
  const unknownResult = validateDocument("execution_handoff", unknown);
  assert.equal(unknownResult.valid, false);
});

test("executor claiming human authority → FAIL", () => {
  const handoff = withTaskHash(fixture("valid-handoff.json"), boundTask());
  handoff.authority_claim = "human_approval";
  const result = validateDocument("execution_handoff", handoff);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(
      (err) =>
        err.includes("authority") || err.includes("executor claiming human authority")
    ),
    result.errors.join("; ")
  );

  const claimed = withTaskHash(fixture("valid-handoff.json"), boundTask());
  claimed.claimed_authority = "github_human_approval";
  const claimedResult = validateDocument("execution_handoff", claimed);
  assert.equal(claimedResult.valid, false);
});

test("Claude claiming human authority → FAIL", () => {
  const review = withTaskHash(fixture("valid-review.json"), boundTask());
  review.authority_claim = "human_approval";
  const result = validateDocument("review_handoff", review);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((err) => err.toLowerCase().includes("authority")),
    result.errors.join("; ")
  );

  const claimed = withTaskHash(fixture("valid-review.json"), boundTask());
  claimed.claimed_authority = "human_approval";
  const claimedResult = validateDocument("review_handoff", claimed);
  assert.equal(claimedResult.valid, false);
});

test("Markdown approval as authority → FAIL", () => {
  const gate = withTaskHash(fixture("valid-approval-gate.json"), boundTask());
  gate.authority_source = "markdown_approval";
  const result = validateDocument("human_approval_gate", gate);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((err) => err.toLowerCase().includes("markdown") || err.includes("github_pr_review")),
    result.errors.join("; ")
  );

  const viaMarkdown = withTaskHash(fixture("valid-approval-gate.json"), boundTask());
  viaMarkdown.markdown_approval = true;
  const viaResult = validateDocument("human_approval_gate", viaMarkdown);
  assert.equal(viaResult.valid, false);
});

test("evidence reference valid", () => {
  const task = boundTask();
  const evidence = withTaskHash(fixture("valid-evidence.json"), task);
  const result = validateDocument("evidence_reference", evidence);
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.equal(evidence.authority_rank, "non-authoritative");
  assert.equal(evidence.input_role, "reference_only");
  assert.equal(evidence.authority_claim, "none");
});

test("invalid lifecycle transition → FAIL", () => {
  const missing = validateTransition("task", undefined, "READY");
  assert.equal(missing.valid, false);

  const impossible = validateTransition("task", "MERGED", "PLANNED");
  assert.equal(impossible.valid, false);
  assert.ok(
    impossible.errors.some((err) => err.includes("invalid lifecycle transition")),
    impossible.errors.join("; ")
  );

  const task = boundTask();
  const doc = withTaskHash(fixture("valid-lifecycle.json"), task);
  doc.from_state = "PLANNED";
  doc.to_state = "MERGED";
  const result = validateDocument("lifecycle_transition", doc);
  assert.equal(result.valid, false);
});

test("valid handoff chain → PASS", () => {
  const chain = validChain();
  const result = validateHandoffChain(chain);
  assert.equal(result.valid, true, result.errors.join("; "));
});

test("contract/hash binding deterministic", () => {
  const task = boundTask();
  const again = stampContractHash(task);
  assert.equal(task.contract_hash, again.contract_hash);

  const reordered = {
    target_role: task.target_role,
    source_role: task.source_role,
    schema_version: task.schema_version,
    document_kind: task.document_kind,
    mission_id: task.mission_id,
    task_id: task.task_id,
    contract_id: task.contract_id,
    state: task.state,
    base_sha: task.base_sha,
    scope_boundaries: task.scope_boundaries,
    acceptance_criteria: task.acceptance_criteria,
    assigned_to: task.assigned_to,
    policy_refs: task.policy_refs,
    evidence_refs: task.evidence_refs,
    authority_claim: task.authority_claim,
    execution_id: task.execution_id,
    lease_token: task.lease_token,
    leased_at: task.leased_at,
    lease_ttl_seconds: task.lease_ttl_seconds,
    heartbeat_at: task.heartbeat_at,
  };
  assert.equal(computeContractHash(reordered), task.contract_hash);
  assert.equal(
    canonicalJson({ b: 1, a: 2 }),
    canonicalJson({ a: 2, b: 1 })
  );

  const tampered = clone(task);
  tampered.acceptance_criteria = ["mutated"];
  assert.notEqual(computeContractHash(tampered), task.contract_hash);

  tampered.contract_hash = task.contract_hash;
  const binding = validateDocument("task_contract", tampered);
  assert.equal(binding.valid, false);
});

test("fail closed for missing or non-object documents", () => {
  assert.equal(validateDocument("task_contract", null).valid, false);
  assert.equal(validateDocument("task_contract", undefined).valid, false);
  assert.equal(validateDocument("task_contract", []).valid, false);
  assert.equal(validateDocument("unknown_kind", {}).valid, false);
  assert.equal(validateHandoffChain(null).valid, false);
});

test("invalid-task-no-base-sha.json fails task.schema.json", () => {
  const result = validate(schema("task.schema.json"), fixture("invalid-task-no-base-sha.json"));
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((err) => err.includes("base_sha")),
    result.errors.join("; ")
  );
});

test("valid-handoff.json matches execution handoff after binding", () => {
  const result = validateDocument(
    "execution_handoff",
    withTaskHash(fixture("valid-handoff.json"), boundTask())
  );
  assert.equal(result.valid, true, result.errors.join("; "));
});

test("invalid-review-no-head.json fails review.schema.json when PUBLISHED", () => {
  const result = validate(schema("review.schema.json"), fixture("invalid-review-no-head.json"));
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((err) => err.includes("reviewed_head_sha")),
    result.errors.join("; ")
  );
});

test("valid-review.json with reviewed_head_sha passes", () => {
  const result = validateDocument(
    "review_handoff",
    withTaskHash(fixture("valid-review.json"), boundTask())
  );
  assert.equal(result.valid, true, result.errors.join("; "));
});

test("human approval gate and policy reference validate", () => {
  const task = boundTask();
  const gate = validateDocument(
    "human_approval_gate",
    withTaskHash(fixture("valid-approval-gate.json"), task)
  );
  const policy = validateDocument(
    "policy_check_reference",
    withTaskHash(fixture("valid-policy.json"), task)
  );
  const lifecycle = validateDocument(
    "lifecycle_transition",
    withTaskHash(fixture("valid-lifecycle.json"), task)
  );
  assert.equal(gate.valid, true, gate.errors.join("; "));
  assert.equal(policy.valid, true, policy.errors.join("; "));
  assert.equal(lifecycle.valid, true, lifecycle.errors.join("; "));
});

test("mission, assignment, and execution envelopes validate", () => {
  const mission = {
    schema_version: "0.5",
    mission_id: "MISSION-20260828-001",
    title: "Task and handoff contracts v0.5",
    state: "IN_PROGRESS",
    base_sha: "eec96d44238d7561f04b86f3195bdac9608284eb",
    scope_boundaries: laboratoryScope,
    acceptance_criteria: ["Contracts are versioned and testable"],
    task_ids: ["TASK-20260828-001"],
    authority_claim: "none",
  };
  const assignment = {
    schema_version: "0.5",
    mission_id: "MISSION-20260828-001",
    task_id: "TASK-20260828-001",
    contract_id: "CONTRACT-20260828-001",
    assigned_to: { kind: "agent", identity: "cursor", role: "executor" },
    assigned_at: "2026-08-28T18:00:00Z",
    authority_claim: "none",
  };
  const execution = {
    schema_version: "0.5",
    mission_id: "MISSION-20260828-001",
    task_id: "TASK-20260828-001",
    contract_id: "CONTRACT-20260828-001",
    execution_id: "EXEC-20260828-001",
    state: "LEASED",
    assigned_to: { kind: "agent", identity: "cursor", role: "executor" },
    base_sha: "eec96d44238d7561f04b86f3195bdac9608284eb",
    lease_token: "opaque-lease-token-01",
    leased_at: "2026-08-28T18:00:00Z",
    lease_ttl_seconds: 3600,
    authority_claim: "none",
  };

  const missionResult = validate(schema("mission.schema.json"), mission);
  const assignmentResult = validate(schema("agent-assignment.schema.json"), assignment);
  const executionResult = validate(schema("execution.schema.json"), execution);

  assert.equal(missionResult.valid, true, missionResult.errors.join("; "));
  assert.equal(assignmentResult.valid, true, assignmentResult.errors.join("; "));
  assert.equal(executionResult.valid, true, executionResult.errors.join("; "));
});

test("unknown task state and extra properties are rejected", () => {
  const task = boundTask();
  task.state = "SELF_APPROVED";
  const enumResult = validateDocument("task_contract", task);
  assert.equal(enumResult.valid, false);

  const extra = boundTask();
  extra.github_approved = true;
  const extraResult = validateDocument("task_contract", extra);
  assert.equal(extraResult.valid, false);
  assert.ok(extraResult.errors.some((err) => err.includes("github_approved")));
});

test("executor cannot self-approve (correlation rule, not schema-only)", () => {
  const bundle = fixture("invalid-executor-self-approve.json");
  bundle.task = stampContractHash(bundle.task);
  bundle.review.contract_hash = bundle.task.contract_hash;
  const taskResult = validateDocument("task_contract", bundle.task);
  const reviewResult = validateDocument("review_handoff", bundle.review);
  assert.equal(taskResult.valid, true, taskResult.errors.join("; "));
  assert.equal(reviewResult.valid, true, reviewResult.errors.join("; "));

  const correlation = validateCorrelation(bundle);
  assert.equal(correlation.valid, false);
  assert.ok(
    correlation.errors.some((err) => err.includes("self-approve")),
    correlation.errors.join("; ")
  );
});

test("distinct executor and human github_approver correlate", () => {
  const bundle = fixture("invalid-executor-self-approve.json");
  bundle.task = stampContractHash(bundle.task);
  bundle.review.contract_hash = bundle.task.contract_hash;
  bundle.review.github_approver.identity = "machubsystem-sketch";
  const correlation = validateCorrelation(bundle);
  assert.equal(correlation.valid, true, correlation.errors.join("; "));
});

test("retry uses a new execution_id; only one active lease", () => {
  const first = {
    execution_id: "EXEC-20260828-001",
    state: "FAILED",
    lease_token: "opaque-lease-token-01",
  };
  const retry = {
    execution_id: "EXEC-20260828-002",
    state: "LEASED",
    lease_token: "opaque-lease-token-02",
  };
  assert.notEqual(first.execution_id, retry.execution_id);

  const twoActive = validateCorrelation({
    executions: [
      { ...first, state: "RUNNING" },
      { ...retry, state: "LEASED" },
    ],
  });
  assert.equal(twoActive.valid, false);
  assert.ok(twoActive.errors.some((err) => err.includes("one active lease")));

  const retryOk = validateCorrelation({ executions: [first, retry] });
  assert.equal(retryOk.valid, true, retryOk.errors.join("; "));
});

test("valid task lifecycle transitions pass; skipped states fail", () => {
  assert.equal(validateTransition("task", "PLANNED", "READY").valid, true);
  assert.equal(validateTransition("task", "READY", "AUTHORIZED").valid, true);
  assert.equal(validateTransition("task", "IN_PROGRESS", "REVIEW_READY").valid, true);
  assert.equal(validateTransition("task", "REVIEWED", "APPROVED").valid, true);
  assert.equal(validateTransition("task", "READY", "MERGED").valid, false);
});
