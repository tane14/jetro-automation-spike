# Task Dispatch Runtime v0.8 — implementation evidence

## Scope

Laboratory repository only: `tane14/jetro-automation-spike`.

v0.8 adds a local Node `TaskDispatchRuntime` that records an executor dispatch for an existing PLANNED Task using canonical Contracts v0.5. It does not run Cursor or Claude, approve, merge, fabricate handoffs/gates, or treat assignment, lease, READY, `valid: true`, or local JSON as human authority.

## SHAs

- BASE_SHA (`origin/main` at branch creation, includes PR #23): `44887f243b1214bd9c946ecbcf6fead575b463a4`
- HEAD_SHA: recorded in the commit on `cursor/task-dispatch-runtime-v08`

## Architecture

```
Mission / Task PLANNED (v0.7)
  → TaskDispatchRuntime
      → Agent Assignment (authority_claim none)
      → Execution LEASED (opaque lease_token, new execution_id)
      → Lifecycle PLANNED → READY
      → Dispatch Package JSON (reference_only)
  → JsonFileMissionTaskStore (assignments/, executions/, transitions/, packages/)
  → StoredControlPlaneDataSource (READ)
  → existing adaptContractBundle
  → Web MVP observational (browser remains mock-first)
```

## Contracts consumed

Unchanged v0.5: `agent-assignment`, `execution`, `lifecycle-transition`, plus existing Task/Mission documents. Validation via `src/contracts` (`validateDocument`, `stampContractHash`, `verifyContractBinding`, `validateCorrelation`, `validateTransition`).

READY is an operational dispatched record. It is not AUTHORIZED and not GitHub APPROVED.

## Concurrency

At most one active lease (`LEASED` or `RUNNING`) per `task_id` in this local process. There is no multi-process lock. Retry after an execution is no longer active requires a new `execution_id`.

## Authority boundary

- GitHub PR review APPROVED + approval-provenance v0.4 remains the only human authority.
- Assignment, lease, execution, READY, package JSON, and `contract_hash` do not authorize.
- Incomplete chains (no execution_handoff / review / gate) stay `invalid`.
- `sufficient_for_authority` remains false; `requires_live_github_approval` remains true.

## Tests

- `node --test src/runtime/runtime.test.js` (v0.7 regression)
- `node --test src/runtime/dispatch.test.js`
- `node --test src/contracts/contracts-v05.test.js`
- `npm test` in `src/web-mvp/`
- Full `src/**/*.test.js` suite

## Qualifications

- No Cursor/Claude/GitHub write transport. The package is a local JSON file a human may open.
- Browser UI stays mock-first; dispatch is a Node API, not a UI button.
- Single-writer lease check only.
- `risk_tier` still absent from Task Contract v0.5.
