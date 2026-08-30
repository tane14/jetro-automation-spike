# Governed execution lifecycle v1.4A — implementation evidence

## Classification

- RISK_TIER=T1
- ENVIRONMENT=LAB_ONLY
- SECURITY_BOUNDARY=NO
- EVIDENCE_AUTHORITY=NO
- TASK_COMPLETION_AUTHORIZED=NO

This slice is **not** completion approval, GitHub approval, merge authority, or an append-only Evidence Ledger.

## Canonical mapping

The execution machine has no `REVIEW_READY` state. v1.4A does **not** invent one.

| Intent | Canonical machine | Transition |
| --- | --- | --- |
| Start after Gate `allowed === true` | execution | `LEASED` → `RUNNING` |
| Start after Gate `allowed === true` | task | `AUTHORIZED` → `IN_PROGRESS` |
| Independent validation PASS | execution | `RUNNING` → `RESULT_SUBMITTED` (reviewable result) |
| Independent validation PASS | task | `IN_PROGRESS` → `REVIEW_READY` (not completed) |
| Independent validation FAIL | execution | `RUNNING` → `FAILED` |
| Independent validation FAIL | task | `IN_PROGRESS` → `FAILED` |

`REVIEW_READY` is not Task completion, not GitHub approval, and not merge.

## Ordering

1. `evaluateStartAuthorization` with `allowed === true` (strict boolean)
2. Persist `RUNNING` / `IN_PROGRESS`
3. Injected runner (tests use a fake; no real Cursor Agent)
4. Independent `validateRunnerResult`
5. Evidence DATA
6. `REVIEW_READY` only if validation PASS

If RUNNING cannot be persisted, the runner is not invoked.

## Contract provenance

- `pre_authorization_contract_hash` from the dispatch package `task_contract_hash` (READY binding)
- `authorized_contract_hash` from the current AUTHORIZED Task `contract_hash`
- Ack `contract_hash` must match the authorized Task binding at start

## Tests

`node --test src/runtime/governedExecution.v14a.test.js`
