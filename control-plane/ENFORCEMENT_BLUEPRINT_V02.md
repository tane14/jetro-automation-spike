# Automation Control Plane — Enforcement Blueprint v0.2

Status: DESIGN_DRAFT
Scope: jetro-automation-spike laboratory only
Mode: Online / GitHub-centered

## Purpose

Convert Control Plane safety rules from policy-only instructions into technical enforcement that can be verified independently before any adoption toward JETRO/IBE.

## Core principle

A task advances only when the GitHub repository and CI can verify the required contract, approval, ancestry, evidence, review, and lifecycle state. Agent-authored claims are never sufficient by themselves.

## Protected branches

### main
Required target behavior:
- direct pushes blocked;
- pull request required;
- at least one approving review required;
- CODEOWNERS review required for governed paths;
- required status checks must pass;
- branch must be up to date before merge;
- force push blocked;
- branch deletion blocked;
- admin bypass should remain disabled for Control Plane validation whenever GitHub plan/settings permit.

### governance branch
For the laboratory, `chatgpt/control-plane-design` remains the canonical governance branch until a dedicated canonical ledger branch is introduced.

Required target behavior:
- governance artifacts changed only by PR;
- CODEOWNERS review required;
- force push/history rewrite blocked;
- required lifecycle checks must pass before governed state changes are accepted.

## Agent write boundaries

### ChatGPT — Orchestrator
May propose or publish on orchestration branches:
- task contracts;
- task state proposals;
- orchestration handoffs;
- consolidated evidence references.

Must not independently satisfy human approval requirements.

### Claude Code — Architect / Reviewer
May publish on reviewer branches:
- contract reviews;
- implementation handoffs;
- review evidence;
- adversarial-review findings.

Must not implement application changes in the Control Plane workflow and must not satisfy human approval requirements.

### Cursor — Executor
May publish on dedicated executor branches:
- implementation files authorized by the task contract;
- tests;
- executor evidence.

Must not modify canonical approval, contract, lifecycle-state, or reviewer-owned governance artifacts.

### Human — Approval Authority
Only a verifiable human GitHub identity may satisfy PRE_EXECUTION_APPROVAL and COMPLETION_APPROVAL.

For hardened operation, approval validity must come from a GitHub-verifiable event or protected governance change, not from a free-form file that any agent can author.

## Required status checks

### 1. `contract-integrity`
Goal: prevent approve-A / execute-B drift.

Must verify:
- Task ID and Contract ID are valid and uniquely mapped;
- approval references the exact approved contract commit SHA;
- approval references a deterministic hash of the approved contract content;
- current contract content still matches the approved SHA/hash;
- any post-approval contract mutation invalidates prior approval and blocks execution.

Failure result: BLOCKED.

### 2. `approval-integrity`
Goal: prevent fake human approval.

Must verify:
- required approval exists for the task/risk tier;
- approval comes from the designated human GitHub identity or other explicitly approved external verifier;
- agent-authored text/file alone cannot satisfy the gate;
- PRE_EXECUTION_APPROVAL predates executor work in the commit graph;
- COMPLETION_APPROVAL is accepted only after independent REVIEWED = PASS.

Failure result: BLOCKED.

### 3. `task-boundary`
Goal: prevent scope creep and cross-task writes.

Must verify:
- executor branch is associated with exactly one Task ID;
- changed paths are allowed by that task's contract and agent role;
- Cursor cannot modify approvals, canonical contracts, canonical state, or reviewer evidence;
- Claude cannot modify implementation paths assigned to Cursor;
- a Task branch cannot modify another task's evidence/state without a separate human-approved governance contract.

Failure result: BLOCKED.

### 4. `validation-evidence`
Goal: replace unverified free-text success claims with inspectable validation evidence.

Must verify:
- required validation command is defined by the contract;
- CI actually runs the required tests/checks when technically possible;
- CI result is tied to the implementation commit under review;
- evidence references the exact implementation SHA and CI run/check;
- evidence correction is additive; historical evidence is not silently rewritten.

Failure result: FAILED or BLOCKED depending on whether validation failed or evidence is invalid.

### 5. `lifecycle-state`
Goal: prevent skipped or conflicting states.

Must verify the allowed state graph:
CONTRACT_READY → PRE_EXECUTION_APPROVAL → EXECUTING → VALIDATING → REVIEW_READY → REVIEWED → COMPLETION_APPROVAL → APPROVED → COMPLETED

Must also verify:
- no required state is skipped;
- exception transitions follow the Control Plane spec;
- executor branch descends from the approved governance commit/approval anchor;
- exactly one canonical state exists for each Task ID;
- conflicting states on multiple branches automatically yield BLOCKED;
- COMPLETED cannot be accepted without REVIEWED = PASS and valid COMPLETION_APPROVAL.

Failure result: BLOCKED.

## Canonical state model

One canonical ledger must exist per Task ID. For v0.2 laboratory hardening, governance records are authoritative only after acceptance into the protected governance branch.

Agent branches are workspaces and evidence sources, not canonical state.

If two branches claim different states for the same Task ID:
- canonical state remains unchanged;
- task becomes BLOCKED;
- human resolution is required.

## Executor ancestry rule

Before REVIEW_READY can be accepted, automation must prove that the executor branch descends from the exact governance/approval anchor that authorized execution.

The check must use Git commit graph ancestry, not agent-provided timestamps or prose.

## Evidence immutability target

Evidence must be backed by:
- immutable commit SHAs;
- protected history where feasible;
- CI/status-check results;
- additive correction records rather than silent rewrites.

Free-text evidence is metadata, not proof of execution.

## Risk-tier enforcement

### T0
Read-only/documentation laboratory work. Minimal CI may be sufficient, but canonical state and evidence remain required.

### T1
Isolated laboratory implementation. PRE_EXECUTION_APPROVAL, executor ancestry, scope-boundary checks, CI validation, independent review, and completion gate are required for the hardened lifecycle test.

### T2
Development/staging impact. Requires explicit human pre-execution approval plus all T1 controls and environment-specific safety checks.

### T3
Production/security/database/infrastructure/destructive operations. Requires explicit pre-execution and completion human approval, protected deployment controls, rollback evidence, and separately verified environment authorization.

T2/T3 are out of scope for this laboratory until later human-approved architecture work.

## Second adversarial review acceptance criteria

The next adversarial review must re-test the 12 known attack paths. A scenario is considered closed only if the applicable control is either:
- TECHNICALLY_ENFORCED, or
- explicitly BLOCKED pending a known external GitHub plan/setting that has not yet been enabled.

`POLICY_ONLY` is not sufficient for readiness beyond the laboratory.

## Second lifecycle T1 release gate

No TASK T1 may start until all of the following are true:
- repository security audit = PASS;
- lab repository visibility/enforcement strategy approved by the human;
- `main` protection verified as active;
- governance protection verified as active or an equivalent protected canonical ledger exists;
- required CI/status checks are present and verified;
- adversarial review v02 has no unresolved high-risk policy-only blocker;
- human explicitly authorizes the second lifecycle.

## Current state

DESIGN ONLY.

No Cursor execution is authorized by this blueprint.
No merge, deploy, VPS, production, database, or JETRO/IBE access is authorized.
