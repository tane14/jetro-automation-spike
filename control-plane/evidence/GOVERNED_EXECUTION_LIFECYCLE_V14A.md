# Governed execution lifecycle v1.4A / v1.4.1 — implementation evidence

## Classification

- RISK_TIER=T1
- ENVIRONMENT=LAB_ONLY
- SECURITY_BOUNDARY=NO
- EVIDENCE_AUTHORITY=NO
- TASK_COMPLETION_AUTHORIZED=NO
- MULTI_FILE_ATOMICITY=NO
- PARTIAL_PERSIST_RECOVERY=NOT_IMPLEMENTED
- FAIL_CLOSED=YES

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

## Ordering (v1.4.1)

1. Bind `runnerRequest` to exact `executionId` / `taskId` / `contractId`
2. Lifecycle independently calls `evaluateStartAuthorization` (`allowed === true` strict boolean, including lease/TTL)
3. Persist `RUNNING` / `IN_PROGRESS`
4. Injected runner (tests use a fake; no real Cursor Agent)
5. Independent `validateRunnerResult`
6. Persist `RESULT_SUBMITTED` + `REVIEW_READY`, or `FAILED` + `FAILED`
7. Evidence DATA describing **actually persisted** states

Caller-supplied `{ allowed: true }` or `{ passed: true }` is not authority.

If RUNNING cannot be persisted, the runner is not invoked.

If Evidence write fails after lifecycle persist: do not roll back; surface the error; lifecycle remains authoritative; Task is not completed.

## Persistence limitations

Multi-file store writes are not atomic. A partial `putExecution(RUNNING)` without `putTask(IN_PROGRESS)` can leave a stuck envelope. Runner remains uninvoked. Recovery is not implemented in this step.

## Contract provenance

- `pre_authorization_contract_hash` from the dispatch package `task_contract_hash` (READY binding)
- `authorized_contract_hash` from the current AUTHORIZED Task `contract_hash`
- Ack `contract_hash` must match the authorized Task binding at start

## Tests

`node --test src/runtime/governedExecution.v14a.test.js`
