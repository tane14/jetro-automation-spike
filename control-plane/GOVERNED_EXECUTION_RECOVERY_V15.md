# Governed Execution Recovery v1.5 — Architectural Contract

## Status

DESIGN_READY_FOR_REVIEW

## Baseline

- Repository: `tane14/jetro-automation-spike`
- Canonical main baseline: `e922211e37f401c47b6a2598b861e31201449063`
- Previous milestone: Governed Execution Lifecycle v1.4.1 (#28)
- Environment: LAB_ONLY
- Human remains final approval authority
- No JETRO/IBE production, VPS, database, deployment, secrets, or cloud changes are authorized by this contract

## Problem statement

v1.4.1 correctly fails closed before invoking the runner when the governed start cannot be persisted, but it explicitly leaves multi-file persistence non-atomic and partial-persist recovery unimplemented.

The next increment must make lifecycle persistence recoverable and idempotent without creating a new source of authority, without allowing runner replay, and without silently promoting Tasks to completion.

## Objective

Introduce a recovery layer for partially persisted governed execution transitions so that the Control Plane can:

1. detect inconsistent Task / Execution / transition state;
2. classify recoverable versus non-recoverable envelopes;
3. reconcile only from canonical persisted facts;
4. retry persistence safely and idempotently;
5. prevent duplicate runner invocation;
6. preserve evidence that describes what was actually persisted;
7. fail closed when state cannot be reconciled unambiguously.

## Non-goals

v1.5 MUST NOT:

- make file-store writes transactional;
- invent distributed transactions;
- mark Tasks COMPLETED;
- approve GitHub PRs or merges;
- replace human approval;
- treat evidence artifacts as authority;
- relax Pre-Execution Gate checks;
- execute production workloads;
- add autonomous Claude execution;
- grant Cursor any policy, lifecycle, approval, or evidence authority.

## Canonical invariants

### Authority

Recovery decisions are derived only from canonical runtime documents and existing lifecycle rules.

Caller-supplied flags such as `force=true`, `allowed=true`, `passed=true`, or `recover=true` are never authority.

### Runner invocation

The runner may be invoked at most once for a governed execution attempt.

Recovery MUST NEVER infer that the runner is safe to invoke merely because an Execution document is `RUNNING`.

A persisted runner-invocation marker / execution attempt identity MUST be checked before any runner call.

### State advancement

Recovery may repair persistence to the state already justified by canonical facts, but MUST NOT advance beyond that state.

Examples:

- Execution `RUNNING` + Task `AUTHORIZED`, with no runner invocation evidence: recovery may reconcile Task to `IN_PROGRESS` if all bindings and transitions prove that `RUNNING` was validly persisted.
- Task `IN_PROGRESS` + Execution `LEASED`: recovery MUST NOT blindly mark Execution `RUNNING`; start authorization must still be re-evaluated and the envelope must be proven consistent.
- Execution `RESULT_SUBMITTED` + Task `IN_PROGRESS`, with independently validated runner result already bound to the execution: recovery may reconcile Task to `REVIEW_READY`.
- Any ambiguity about whether the runner executed: fail closed; do not invoke runner.

### Completion boundary

`REVIEW_READY` remains reviewable result only.

Recovery cannot transition Task to `COMPLETED`, cannot perform completion approval, and cannot merge code.

## Recovery classifications

The runtime SHOULD classify observed envelopes into at least:

- `CONSISTENT`
- `RECOVERABLE_START_PARTIAL`
- `RECOVERABLE_RESULT_PARTIAL`
- `RECOVERABLE_EVIDENCE_MISSING`
- `STALE_LEASE`
- `AMBIGUOUS_RUNNER_INVOCATION`
- `CORRUPT_BINDING`
- `UNRECOVERABLE`

Every recovery result MUST include machine-readable reasons.

## Required scenarios

### R1 — Execution persisted RUNNING; Task remained AUTHORIZED

Given:
- valid pre-execution authorization;
- valid task/execution correlation;
- Execution is `RUNNING`;
- Task is still `AUTHORIZED`;
- runner has not been invoked;

Then:
- recovery may persist Task `IN_PROGRESS` and missing lifecycle transition(s);
- runner is still invoked only by the normal governed run path after reconciliation;
- recovery is idempotent.

### R2 — Task persisted IN_PROGRESS; Execution remained LEASED

Given:
- Task is `IN_PROGRESS`;
- Execution is `LEASED`;

Then:
- recovery MUST NOT assume start succeeded;
- re-evaluate authorization, contract binding, lease/TTL, correlation, and transition evidence;
- if canonical facts cannot prove the intended start transition, classify `UNRECOVERABLE` or `STALE_LEASE` and fail closed.

### R3 — Runner result persisted; Task not REVIEW_READY

Given:
- Execution is `RESULT_SUBMITTED`;
- Task is `IN_PROGRESS`;
- independently validated runner result is available and bound to the same execution/contract;

Then:
- recovery may persist Task `REVIEW_READY` and missing transition(s);
- MUST NOT rerun the executor.

### R4 — Evidence write failed after lifecycle persistence

Given:
- canonical Task/Execution state is already persisted;
- evidence artifact is missing;

Then:
- recovery may regenerate DATA evidence from canonical persisted state;
- evidence remains non-authoritative;
- recovery MUST NOT roll lifecycle state backward solely because evidence is absent.

### R5 — Unknown whether runner executed

Given:
- state is inconsistent;
- no reliable invocation marker or result can prove whether the runner already ran;

Then:
- classify `AMBIGUOUS_RUNNER_INVOCATION`;
- fail closed;
- do not invoke Cursor;
- require explicit operator/human intervention for resolution.

### R6 — Repeat recovery request

Repeated recovery against an already reconciled envelope MUST produce no duplicate state transitions, no duplicate runner invocation, and no contradictory evidence.

## Idempotency contract

Recovery operations MUST be idempotent with respect to:

- `execution_id`
- `task_id`
- `contract_id`
- active `contract_hash`
- lifecycle transition identity
- runner attempt identity

Transition writes SHOULD use deterministic keys derived from execution + from_state + to_state.

## Recovery evidence

Recovery SHOULD emit a structured evidence document containing at least:

- schema/version
- execution_id
- task_id
- contract_id
- contract_hash
- observed state before recovery
- classification
- actions attempted
- persisted state after recovery
- runner_invoked = false/true observed fact
- recovery_id / deterministic correlation identifier
- decision reasons
- authority_claim = none

The evidence document is DATA only and MUST NOT be read back as approval authority.

## Failure semantics

The runtime MUST fail closed on:

- invalid or mismatched contract binding;
- missing canonical documents required to prove correlation;
- unknown runner invocation state;
- incompatible lifecycle states;
- expired or invalid authorization where re-evaluation is required;
- malformed persisted runtime documents;
- recovery attempts that would require inventing a transition not supported by the canonical state machine.

## Proposed implementation boundary

Preferred implementation shape:

- `src/runtime/GovernedExecutionRecovery.js`
- `src/runtime/governedExecutionRecovery.v15.test.js`
- minimal additions to store interfaces only when required for deterministic recovery facts
- evidence artifact under `control-plane/evidence/`

Avoid broad rewrites of v1.4.1.

## Minimum test matrix

1. consistent envelope -> no-op PASS
2. R1 partial start -> reconcile, runner count remains 0 during recovery
3. R1 repeated -> idempotent no-op
4. R2 ambiguous inverse partial -> BLOCKED/FAIL-CLOSED
5. R3 partial result -> REVIEW_READY without runner replay
6. R4 evidence missing -> regenerate evidence only
7. R5 unknown runner invocation -> BLOCKED
8. contract hash mismatch -> BLOCKED
9. correlation mismatch -> BLOCKED
10. stale authorization/lease when required -> BLOCKED
11. transition already present -> no duplicate transition
12. injected persistence failure during recovery -> explicit error; no false success

## Acceptance criteria

v1.5 is eligible for implementation approval only if review confirms:

- no new authority source was introduced;
- runner replay is impossible in ambiguous recovery paths;
- recovery is idempotent;
- recovery cannot complete Tasks;
- canonical contract binding remains enforced;
- failure paths are fail-closed;
- JETRO/IBE production remains untouched.

## Recommended next gate

`ARCHITECTURE_REVIEW_REQUIRED`

After independent review and human approval, implementation should occur in a separate execution branch/PR. This design document alone does not authorize implementation or merge.
