# Executor Exchange Runtime v0.9 — implementation evidence

## Scope

Laboratory repository only: `tane14/jetro-automation-spike`.

v0.9 adds a local Node `ExecutorExchangeRuntime` that exports a v0.8 dispatch package to `exchange/outbox/` and ingests a canonical `execution_handoff` (Contracts v0.5 `handoff-result.schema.json`). It does not call Cursor, Claude, or GitHub, does not promote Task state, and does not treat SUCCESS / RESULT_SUBMITTED / JSON as human authority.

## Flags

- LOCAL_EXCHANGE_ONLY
- HUMAN_TRIGGER_REQUIRED
- NO_CURSOR_AUTOMATION
- NO_CLAUDE_AUTOMATION
- NO_GITHUB_AUTHORITY_CHANGE
- RESULT_IS_NOT_REVIEW
- SUCCESS_IS_NOT_APPROVAL

## SHAs

- BASE_SHA (`origin/main` at branch creation, includes PR #24): `36fdb648b134844c48c1d58e4e9b71c53a5c14fa`
- HEAD_SHA: recorded in the commit on `cursor/executor-exchange-runtime-v09`

## Architecture

```
TaskDispatchRuntime (v0.8)
  → Dispatch Package JSON
  → ExecutorExchangeRuntime.exportDispatchPackage
      → exchange/outbox/{execution_id}.json
  → human opens package locally in Cursor (optional)
  → executor writes execution_handoff JSON
  → ExecutorExchangeRuntime.ingestHandoff (CLI)
      → handoffs/{execution_id}.json
      → execution LEASED → RUNNING → RESULT_SUBMITTED
      → Task remains READY
  → StoredControlPlaneDataSource READ
  → Web MVP observational
```

## Contracts consumed

Unchanged v0.5: `handoff-result` (`execution_handoff`), `execution`, `lifecycle-transition`. Validation via `src/contracts` (`validateDocument`, `verifyContractBinding`, `verifyCopiedBinding`, `validateCorrelation`, `validateTransition`). `src/contracts/lifecycle.js` is not modified.

RUNNING is recorded as a machine step during ingest. It is not live agent confirmation and not authorization.

## Concurrency / replay

At most one persisted handoff per `execution_id`. A second ingest fails closed. Retry requires a new `execution_id` from v0.8 dispatch. Lease check is single-writer in this process. No multi-process lock (Q2 remains).

## Authority boundary

- GitHub PR review APPROVED + approval-provenance v0.4 remains the only human authority.
- Assignment, lease, RUNNING, RESULT_SUBMITTED, outcome SUCCESS, execution_handoff, package JSON, and `contract_hash` do not authorize.
- Incomplete chains (no review_handoff / human approval gate) stay `invalid`.
- `sufficient_for_authority` remains false; `requires_live_github_approval` remains true.

## Tests

- `node --test src/runtime/exchange.test.js`
- `node --test src/runtime/dispatch.test.js`
- `node --test src/runtime/runtime.test.js`
- `node --test src/contracts/contracts-v05.test.js`
- `npm test` in `src/web-mvp/`
- Full `src/**/*.test.js` suite

## Qualifications

- Human must run the CLI. There is no watcher, HTTP server, Cursor SDK, or Claude API.
- SUCCESS requires `pr_number` and `head_sha` by schema; that is not live GitHub verification.
- Q2 multi-file transaction, Q3 timeout daemon, Q4 package refresh, Q5 assignment history, Q6 corruption isolation remain follow-up debt.
