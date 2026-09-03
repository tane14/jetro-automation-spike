# Governed execution recovery v1.5 — implementation evidence

## Classification

- RISK_TIER=T1
- ENVIRONMENT=LAB_ONLY
- SECURITY_BOUNDARY=NO
- EVIDENCE_AUTHORITY=NO
- TASK_COMPLETION_AUTHORIZED=NO
- MULTI_FILE_ATOMICITY=NO
- PARTIAL_PERSIST_RECOVERY=YES
- FAIL_CLOSED=YES
- RUNNER_REPLAY_IN_RECOVERY=NO
- AUTHORITY_CLAIM=none

This slice is **not** completion approval, GitHub approval, merge authority, Pre-Execution Gate replacement, or an append-only Evidence Ledger.

Recovery has no policy, approval, completion, merge, or evidence authority.

## Scope

Implements `control-plane/GOVERNED_EXECUTION_RECOVERY_V15.md` on branch `cursor/governed-execution-recovery-v15` from canonical main `af08e92791c9bd46dee112b21c7e1c87173bcbeb`.

v1.4.1 lifecycle semantics are preserved. Recovery is an additive repair layer for partial multi-file persist.

## Canonical mapping

| Observed envelope | Classification | Repair |
| --- | --- | --- |
| Matching Task/Execution pair with expected transitions | `CONSISTENT` | no-op |
| Execution `RUNNING` + Task `AUTHORIZED`, runner attempt absent | `RECOVERABLE_START_PARTIAL` | Task `IN_PROGRESS` + missing start transitions |
| Task `IN_PROGRESS` + Execution `LEASED` | `UNRECOVERABLE` or `STALE_LEASE` | none; never invent `RUNNING` |
| Execution `RESULT_SUBMITTED` + Task `IN_PROGRESS`, independently validated stored result | `RECOVERABLE_RESULT_PARTIAL` | Task `REVIEW_READY` + missing result transitions |
| Canonical result states persisted, governed-run evidence missing | `RECOVERABLE_EVIDENCE_MISSING` | regenerate DATA evidence only |
| Runner invocation marker missing/malformed/contradictory | `AMBIGUOUS_RUNNER_INVOCATION` | none; BLOCKED |
| Hash/ID/correlation mismatch | `CORRUPT_BINDING` | none; BLOCKED |

Recovery never transitions Task to `COMPLETED`.

## Runner replay prevention

Before the normal governed runner call, `GovernedExecutionRuntime` persists a deterministic attempt identity:

`ATTEMPT-{execution_id}` with `invocation_state=INVOKED`, then `RETURNED` after the runner returns.

Recovery never calls a runner. If invocation cannot be proven from that marker (or from a bound validated result), classification is `AMBIGUOUS_RUNNER_INVOCATION` and the outcome is `BLOCKED`.

## Idempotency

Transition writes reuse deterministic suffixes:

- `LEASED-RUNNING`
- `AUTHORIZED-IN_PROGRESS`
- `RUNNING-RESULT_SUBMITTED`
- `IN_PROGRESS-REVIEW_READY`

`recovery_id` is `RECV-{execution_id}`. Repeated recovery does not duplicate transitions or runner invocations.

Caller flags `force`, `allowed`, `passed`, and `recover` are ignored as authority.

## Tests

- targeted: `node --test src/runtime/governedExecutionRecovery.v15.test.js`
- regression: `node --test src/runtime/governedExecution.v14a.test.js`
- full suite: all `src/**/*.test.js` (200 pass, 0 fail, 0 skipped)

## Authority boundaries

- Task completion authority: none
- GitHub approval authority: none
- Merge authority: none
- Evidence authority: none (DATA only)
- Cursor policy authority: none
