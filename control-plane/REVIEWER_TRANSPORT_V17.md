# Reviewer Transport v1.7 — Architectural Contract

## Status

DESIGN_READY_FOR_REVIEW

## Baseline

- Repository: `tane14/jetro-automation-spike`
- Canonical main baseline: `7c4bd68685ff7f8f04ab76886b731c1731062c90`
- Previous milestone: Reviewer Automation v1.6 / PR #32
- Environment: LAB_ONLY
- Human remains final approval authority
- No JETRO/IBE production, VPS, database, deployment, secrets, cloud, or production workload changes are authorized

## Problem statement

Reviewer Automation v1.6 proved governed reviewer lifecycle semantics with an injected fake adapter. The remaining manual gap is provider transport: the Control Plane still cannot send a canonical review request to an external reviewer process and ingest a structured result without manual prompt shuttling.

The next increment must introduce a provider-neutral transport layer around the existing `ReviewerAdapter` contract while preserving exact-head binding, reviewer independence, fail-closed validation, and human final approval authority.

## Objective

Reviewer Transport v1.7 must allow the Control Plane to:

1. materialize an immutable provider request package from a canonical `review_handoff`;
2. invoke an external reviewer transport through a narrow process/CLI boundary;
3. ingest exactly one structured provider response bound to the same review ID and implementation head SHA;
4. validate provider exit status, response schema, correlation, reviewer identity, and verdict independently;
5. fail closed on timeout, malformed output, missing output, multiple contradictory outputs, head mismatch, or identity mismatch;
6. separate provider transport from reviewer lifecycle authority;
7. support Claude later as a provider adapter without coupling the core runtime to Claude-specific SDK/API semantics;
8. preserve non-authoritative evidence describing what was actually invoked and returned.

## Non-goals

v1.7 MUST NOT:

- merge pull requests;
- approve GitHub pull requests;
- mark Tasks COMPLETED;
- replace GitHub approval provenance;
- grant provider output policy authority;
- grant reviewer output merge/completion/evidence authority;
- hard-code Anthropic/Claude network SDKs into lifecycle core;
- store API keys or secrets in Task, Execution, review_handoff, review_result, evidence, or repository files;
- execute against JETRO/IBE production;
- make external provider availability a prerequisite for the core review lifecycle tests;
- infer PASS from process exit code alone;
- infer PASS from prose;
- retry ambiguous provider executions in a way that could create duplicate paid/external review runs.

## Architectural separation

The canonical layering is:

`ReviewerAutomation -> ReviewerAdapter -> ReviewerTransport -> external reviewer process/provider`

Responsibilities:

- `ReviewerAutomation`: canonical review lifecycle, binding validation, verdict handling.
- `ReviewerAdapter`: provider-neutral reviewer interface.
- `ReviewerTransport`: process/CLI exchange, timeout, stdout/stderr/result-file handling, invocation identity.
- provider-specific wrapper: converts canonical request package into provider invocation and returns structured result.

Transport output is untrusted until independently validated by Reviewer Automation.

## Canonical transport request

A transport request SHOULD contain at least:

- schema_version
- document_kind = `review_transport_request`
- transport_request_id
- review_id
- mission_id
- task_id
- execution_id
- contract_id
- contract_hash
- implementation_head_sha
- executor_identity
- requested_reviewer_identity
- reviewer_class/provider
- review_scope
- required_checks
- input_artifact_refs[]
- created_at
- authority_claim = `none`

`transport_request_id` SHOULD be deterministic from `review_id + provider/reviewer identity`.

## Canonical transport response

A transport response SHOULD contain at least:

- schema_version
- document_kind = `review_transport_response`
- transport_request_id
- review_id
- reviewed_head_sha
- reviewer_identity
- reviewer_class/provider
- process_exit_code
- process_completed
- provider_invocation_id or deterministic invocation correlation
- review_result payload or review_result_ref
- submitted_at
- authority_claim = `none`

The response MUST NOT be accepted as a valid review merely because `process_exit_code == 0`.

## Invocation identity and replay prevention

External provider invocation may incur cost and side effects. v1.7 therefore requires deterministic invocation tracking.

Before invoking the provider, persist a transport-attempt record containing:

- transport_request_id
- review_id
- implementation_head_sha
- reviewer identity/provider
- invocation_state = `PREPARED | INVOKED | RETURNED | FAILED | TIMED_OUT`
- started_at
- finished_at when known
- authority_claim = `none`

If the process is known to have reached `INVOKED` but the final outcome is unknown, automatic replay MUST NOT occur.

Classify as `AMBIGUOUS_REVIEW_PROVIDER_INVOCATION` and require operator/human intervention.

## Transport classifications

At minimum support:

- `TRANSPORT_NOT_PREPARED`
- `TRANSPORT_PREPARED`
- `TRANSPORT_INVOKED`
- `TRANSPORT_RESULT_RETURNED`
- `TRANSPORT_PROVIDER_FAILED`
- `TRANSPORT_TIMEOUT`
- `TRANSPORT_RESULT_INVALID`
- `TRANSPORT_RESULT_STALE_HEAD`
- `TRANSPORT_IDENTITY_CONFLICT`
- `TRANSPORT_CORRUPT_BINDING`
- `AMBIGUOUS_REVIEW_PROVIDER_INVOCATION`
- `TRANSPORT_BLOCKED`

Every classification MUST include machine-readable reasons.

## Exact-head and review binding

The following values MUST remain equal across `review_handoff`, transport request, transport attempt, transport response, and final `review_result`:

- review_id
- execution_id where present
- contract_id where present
- contract_hash where present
- implementation/reviewed head SHA
- canonical reviewer identity

A response for HEAD A is invalid for HEAD B.

## Reviewer identity

Provider name is not reviewer identity.

For example, `provider=claude` does not prove a specific reviewer identity.

The provider wrapper must return a canonical `reviewer_identity`, and Reviewer Automation must still enforce independence from the executor.

## Process/CLI boundary

The preferred first real transport is a local CLI/process adapter, not a direct SDK dependency in the core.

A narrow interface may resemble:

```js
reviewerTransport.invoke({ requestPath, resultPath, timeoutMs, envAllowlist })
```

Requirements:

- explicit executable/command supplied by configuration outside canonical review documents;
- explicit timeout;
- no shell interpolation of untrusted review fields;
- bounded stdout/stderr capture;
- result read from one deterministic structured output path or stdout JSON contract;
- non-zero exit => provider failure unless a separately valid result contract explicitly says otherwise;
- environment variables passed through an allowlist, never dumped to evidence;
- secrets never serialized into request/result/evidence artifacts.

## Provider-neutral first slice

The first v1.7 implementation SHOULD prove transport with a fake/local executable or injected process runner.

A real Claude CLI/provider wrapper may be added only as a thin adapter if and when the runtime environment can invoke it safely. The core contract must not depend on Claude availability.

## Failure semantics

Fail closed on:

- missing canonical review_handoff;
- missing exact implementation head SHA;
- transport request mismatch;
- result head mismatch;
- result review_id mismatch;
- contract/correlation mismatch;
- reviewer identity mismatch;
- executor/reviewer identity conflict;
- unknown/malformed verdict in returned review_result;
- process timeout;
- process crash/non-zero exit without valid contract;
- missing structured output;
- malformed JSON;
- multiple conflicting outputs;
- invocation state unknown after provider may have run;
- authority_claim other than none;
- secret material detected in canonical artifacts/evidence.

## Idempotency

Transport preparation and result ingestion MUST be idempotent with respect to:

- review_id
- implementation_head_sha
- reviewer_identity
- provider
- transport_request_id

Repeated ingestion of the same valid returned result must not duplicate review records or transitions.

Repeated invocation is allowed only when canonical facts prove the prior provider process was never invoked. If invocation may have happened, fail closed instead of replaying.

## Evidence

Transport evidence SHOULD include:

- transport_request_id
- review_id
- implementation_head_sha
- provider/reviewer identity
- invocation state before/after
- process exit code when known
- timeout fact
- result validation classification
- stdout/stderr byte counts, not secret/raw dumps by default
- persisted result reference
- authority_claim = none

Evidence is DATA only.

## Proposed implementation boundary

Preferred shape:

- `src/runtime/ReviewerTransport.js`
- `src/runtime/ProcessReviewerTransport.js`
- `src/runtime/ReviewerTransportAdapter.js` or minimal extension of `ReviewerAdapter.js`
- `src/runtime/reviewerTransport.v17.test.js`
- minimal additive store methods for transport requests/attempts/responses
- evidence artifact under `control-plane/evidence/`

Avoid broad rewrites of ReviewerAutomation v1.6, GovernedExecutionRecovery v1.5, lifecycle v1.4.1, or approval-provenance.

## Minimum test matrix

1. prepare valid transport request -> PREPARED
2. invoke fake process -> INVOKED -> RETURNED
3. valid structured PASS result exact head -> accepted by existing reviewer automation
4. PASS_WITH_QUALIFICATIONS preserved
5. REQUEST_CHANGES preserved
6. BLOCKED preserved
7. process exit 0 but malformed output -> BLOCKED
8. process non-zero -> TRANSPORT_PROVIDER_FAILED
9. timeout -> TRANSPORT_TIMEOUT
10. missing output -> TRANSPORT_RESULT_INVALID
11. head mismatch -> TRANSPORT_RESULT_STALE_HEAD
12. review_id mismatch -> TRANSPORT_CORRUPT_BINDING
13. reviewer identity mismatch -> TRANSPORT_IDENTITY_CONFLICT
14. executor == reviewer -> fail closed through existing reviewer independence validation
15. repeated result ingestion -> idempotent
16. prior attempt PREPARED only -> safe deterministic retry allowed
17. prior attempt INVOKED with unknown result -> AMBIGUOUS_REVIEW_PROVIDER_INVOCATION, no replay
18. secret-like env/value never appears in request/result/evidence fixtures
19. command arguments are passed without shell interpolation
20. authority_claim != none -> BLOCKED
21. stale HEAD A result cannot satisfy HEAD B
22. v1.6 reviewer tests remain PASS
23. v1.5 recovery tests remain PASS
24. v1.4.1 lifecycle tests remain PASS

## Acceptance criteria

v1.7 is eligible for implementation only if review confirms:

- transport is provider-neutral;
- exact-head binding remains mandatory;
- external invocation replay is prevented when ambiguous;
- reviewer identity remains independent from provider label;
- structured result validation remains in ReviewerAutomation, not trusted transport output;
- secrets cannot enter canonical artifacts/evidence;
- external process invocation does not use unsafe shell interpolation;
- fake/injected process transport can prove semantics without external credentials;
- real Claude support remains a thin future/provider adapter, not kernel coupling;
- human remains final approval authority;
- JETRO/IBE remains untouched.

## Recommended next gate

`ARCHITECTURE_REVIEW_REQUIRED`

After independent architecture review and explicit human approval, implement Reviewer Transport v1.7 in a separate branch/PR. A real Claude invocation should be attempted only after the provider-neutral process transport contract is proven and only in an isolated lab environment.
