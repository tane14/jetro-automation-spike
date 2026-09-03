# Reviewer Automation v1.6 — Architectural Contract

## Status

DESIGN_READY_FOR_REVIEW

## Baseline

- Repository: `tane14/jetro-automation-spike`
- Canonical main baseline: `23e6281070cbbee8e6754234d4610ffbba096348`
- Previous milestone: Governed Execution Recovery v1.5 / PR #30
- Environment: LAB_ONLY
- Human remains final approval authority
- No JETRO/IBE production, VPS, database, deployment, secrets, cloud, or production workload changes are authorized

## Problem statement

The Control Plane can now govern execution start, run Cursor through a controlled runner path, validate results, persist lifecycle state, recover partial persistence, and emit non-authoritative evidence. The remaining operational gap is reviewer transport: an independent reviewer is still not invoked and correlated as part of the governed lifecycle without manual prompt shuttling.

The next increment must introduce a governed reviewer-dispatch contract that can carry a review request from the Control Plane to an external reviewer adapter and ingest a structured review result, without granting that reviewer approval, merge, completion, policy, or evidence authority.

## Objective

Define a reviewer automation layer that allows the Control Plane to:

1. create a canonical review request bound to an exact implementation head SHA and Task/Execution/Contract identity;
2. dispatch that request through a pluggable reviewer adapter;
3. ingest a structured review result bound to the same immutable identities;
4. distinguish reviewer findings from GitHub approval provenance;
5. fail closed on identity, head, contract, correlation, or schema mismatch;
6. persist review handoff/result records deterministically and idempotently;
7. never interpret reviewer output as human completion approval or merge authority;
8. support future Claude integration without coupling core lifecycle code to one provider.

## Non-goals

v1.6 MUST NOT:

- merge pull requests;
- approve GitHub pull requests;
- mark Tasks COMPLETED;
- replace the human final approval gate;
- make Claude, Cursor, or any reviewer a policy authority;
- make reviewer output Evidence Authority;
- weaken `approval-provenance`;
- bypass branch protection or required checks;
- call JETRO/IBE production systems;
- require secrets inside canonical Task/Review documents;
- hard-code Claude-specific transport into the lifecycle core;
- infer PASS from free-form prose;
- accept review results for a different head SHA.

## Canonical role separation

The existing contract model already defines the intended chain:

`ChatGPT Orchestrator → Cursor Executor → Claude Reviewer → Human Authority`

Reviewer identity MUST be distinct from executor identity. Existing identity-separation constraints remain canonical.

The reviewer provides an independent technical assessment only.

The reviewer does not grant:

- Task completion;
- GitHub approval;
- merge permission;
- policy override;
- evidence authority.

## Core records

### Review request

Introduce a structured review request/handoff record containing at least:

- schema_version
- document_kind = `review_handoff`
- review_id
- mission_id
- task_id
- execution_id
- contract_id
- contract_hash
- implementation_head_sha
- executor_identity
- requested_reviewer_identity or reviewer_class
- review_scope
- required_checks
- created_at
- authority_claim = `none`

`review_id` SHOULD be deterministic from execution + exact head SHA.

### Review result

Introduce a structured review result containing at least:

- schema_version
- document_kind = `review_result`
- review_id
- mission_id
- task_id
- execution_id
- contract_id
- contract_hash
- reviewed_head_sha
- reviewer_identity
- reviewer_class/provider
- verdict = `PASS | PASS_WITH_QUALIFICATIONS | REQUEST_CHANGES | BLOCKED`
- findings[]
- qualifications[]
- tests_or_evidence_considered[]
- submitted_at
- authority_claim = `none`

Free-form text MAY be attached as data, but lifecycle decisions MUST use the structured fields only after validation.

## Exact-head binding

The most important v1.6 invariant is immutable review binding.

`review_result.reviewed_head_sha` MUST equal `review_handoff.implementation_head_sha`.

If the implementation branch moves after review:

- the previous result becomes stale for the new head;
- it MUST NOT be silently reused;
- a new deterministic review request/result cycle is required;
- GitHub approval provenance remains independently responsible for GitHub review binding.

## Contract and correlation binding

The following identities MUST match across Task, Execution, review_handoff, and review_result:

- mission_id
- task_id
- execution_id
- contract_id
- contract_hash

Any mismatch is `CORRUPT_REVIEW_BINDING` and MUST fail closed.

## Reviewer independence

The reviewer identity MUST NOT equal:

- executor identity;
- Cursor runner identity when Cursor executed the implementation;
- any identity explicitly forbidden by the existing contract separation rules.

A provider label such as `claude` is not sufficient identity proof by itself.

Identity must be represented by a canonical reviewer identity field and validated against the current contract model.

## Adapter architecture

The core runtime SHOULD depend on a narrow interface such as:

```js
reviewerAdapter.review(reviewRequest) -> reviewResult
```

The core MUST validate the returned result independently.

Provider-specific implementations should live outside the lifecycle core, for example:

- `ReviewerAdapter`
- `FakeReviewerAdapter` for tests
- future `ClaudeReviewerAdapter`

The architecture MUST allow the current lab to prove lifecycle semantics with a fake/injected adapter before any external Claude credential or API integration is attempted.

## Review lifecycle classifications

At minimum support:

- `REVIEW_NOT_REQUESTED`
- `REVIEW_REQUESTED`
- `REVIEW_RESULT_ACCEPTED`
- `REVIEW_RESULT_STALE_HEAD`
- `CORRUPT_REVIEW_BINDING`
- `REVIEWER_IDENTITY_CONFLICT`
- `REVIEW_RESULT_INVALID`
- `REVIEW_PROVIDER_FAILED`
- `REVIEW_BLOCKED`

All results MUST contain machine-readable reasons.

## Verdict semantics

### PASS

Independent reviewer found no blocking issue for the exact reviewed head.

This does NOT approve merge or complete the Task.

### PASS_WITH_QUALIFICATIONS

No blocking issue, but explicit qualifications remain. These qualifications MUST be preserved for the human gate.

### REQUEST_CHANGES

Blocking technical findings exist. The Control Plane MUST NOT advance toward completion approval for that head.

### BLOCKED

The reviewer could not produce a valid review. This is not equivalent to PASS or REQUEST_CHANGES.

## State boundary

Reviewer automation MAY annotate or move a Task into an explicitly review-related state only if that state already exists in the canonical state machine.

If no such canonical state exists, v1.6 MUST persist review records without inventing a new completion state.

`REVIEW_READY` remains non-final and reviewable.

v1.6 MUST NOT transition to `COMPLETED`.

## Idempotency

Review dispatch and ingestion MUST be idempotent with respect to:

- execution_id
- task_id
- contract_id
- contract_hash
- implementation_head_sha
- reviewer identity/class

Repeated ingestion of the exact same valid result MUST not duplicate records or lifecycle transitions.

A different head SHA MUST create a distinct review cycle.

## Failure semantics

Fail closed on:

- missing implementation head SHA;
- reviewed head SHA mismatch;
- contract hash mismatch;
- task/execution/review correlation mismatch;
- executor == reviewer identity;
- malformed result schema;
- unknown verdict;
- provider exception/timeout;
- absent canonical Task or Execution;
- attempt to claim approval/merge/completion authority;
- attempt to use reviewer prose instead of structured validated fields as authority.

## Evidence

Reviewer automation SHOULD emit structured DATA evidence describing:

- review request identity;
- exact implementation head SHA;
- reviewer identity/class;
- validated verdict;
- findings count;
- qualifications count;
- before/after persisted review state;
- provider execution fact;
- authority_claim = none.

Evidence is non-authoritative and MUST NOT be read back as approval authority.

## Proposed implementation boundary

Preferred shape:

- `src/runtime/ReviewerAutomation.js`
- `src/runtime/ReviewerAdapter.js`
- `src/runtime/reviewerAutomation.v16.test.js`
- minimal additive store methods for review handoff/result records
- evidence artifact under `control-plane/evidence/`

Avoid broad rewrites of v1.5 lifecycle/recovery.

Do not implement a real Claude network integration in the first implementation slice. First prove the governed reviewer lifecycle with an injected fake adapter and exact-head validation.

## Minimum test matrix

1. valid review request for exact head -> REQUESTED
2. valid PASS result exact head -> ACCEPTED
3. valid PASS_WITH_QUALIFICATIONS -> qualifications preserved
4. REQUEST_CHANGES -> blocking result preserved, no completion
5. BLOCKED -> fail closed/no false pass
6. reviewed head mismatch -> STALE_HEAD/BLOCKED
7. contract hash mismatch -> CORRUPT_REVIEW_BINDING
8. task/execution correlation mismatch -> CORRUPT_REVIEW_BINDING
9. executor identity == reviewer identity -> REVIEWER_IDENTITY_CONFLICT
10. malformed review result -> REVIEW_RESULT_INVALID
11. unknown verdict -> REVIEW_RESULT_INVALID
12. provider throws/fails -> REVIEW_PROVIDER_FAILED
13. repeated same result -> idempotent no duplicate
14. branch/head changes -> previous result not reusable
15. authority_claim other than none -> BLOCKED
16. reviewer result cannot transition Task to COMPLETED
17. existing v1.5 recovery and v1.4.1 lifecycle regressions remain PASS

## Acceptance criteria

v1.6 is eligible for implementation only if review confirms:

- exact-head review binding is mandatory;
- reviewer identity separation is enforced;
- reviewer output is never merge/completion/GitHub approval authority;
- result ingestion is schema-validated and fail-closed;
- provider transport is pluggable;
- fake adapter can prove the lifecycle without external secrets;
- stale reviews cannot be reused after a head change;
- existing approval-provenance remains independent and unchanged;
- JETRO/IBE remains untouched.

## Recommended next gate

`ARCHITECTURE_REVIEW_REQUIRED`

After independent architecture review and human approval, implement the governed reviewer lifecycle in a separate execution branch/PR. Real Claude transport should be a later adapter slice after the lifecycle contract is proven.
