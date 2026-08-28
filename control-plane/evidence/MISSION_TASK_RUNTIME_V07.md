# Mission/Task Runtime v0.7 — implementation evidence

## Scope

Laboratory repository only: `tane14/jetro-automation-spike`.

v0.7 adds a local Node runtime that creates and persists canonical Contracts v0.5 Mission and Task documents. It does not approve, merge, dispatch agents, mutate approval-provenance, alter the GitHub workflow/ruleset, access VPS/production/JETRO/IBE, or treat `valid: true` / a local JSON file as human authority.

## SHAs

- BASE_SHA (`origin/main` at branch creation, includes PR #22): `19473c94e59ad58e25ed9c2dab1158af64b96577`
- HEAD_SHA: recorded in the commit on `cursor/mission-task-runtime-v07`

## Architecture implemented

```
GPT/Human input
  → MissionTaskRuntime
  → MissionTaskStore
  → JsonFileMissionTaskStore (configurable directory; tests use tmp)
        ↑
StoredControlPlaneDataSource (READ-ONLY)
  → existing adaptContractBundle
  → Web MVP (observational; browser default remains mock)
```

`StoredControlPlaneDataSource` is `src/runtime/StoredControlPlaneDataSource.js` so `node --test` and CI `find src -name '*.test.js'` can load it without a TypeScript toolchain. The Vite browser bundle does not import it (Node `fs`).

## Contracts consumed

Unchanged v0.5 schemas. Runtime calls `validateDocument`, `stampContractHash`, `verifyContractBinding`, and `validateCorrelation` from `src/contracts`.

New Mission: `state=PLANNED`, `authority_claim=none`, required `base_sha`.
New Task: existing `mission_id`, `state=PLANNED`, `source_role=orchestrator`, `target_role=executor`, canonical `contract_hash`.

The runtime does not decompose missions. It records each Task the orchestrator/human supplies.

## Persistence

- One JSON document per file (`missions/*.json`, `tasks/*.json`).
- Tests use `os.tmpdir()`.
- Lab path `control-plane/runtime-state/` is gitignored.
- Store refuses roots under `control-plane/tasks` or `control-plane/approvals`.
- No Markdown storage. Store does not interpret authority.

## Authority boundary

- Live GitHub PR review APPROVED + approval-provenance v0.4 remains the only human authority.
- Local JSON, `contract_hash`, and `valid: true` are not approval.
- `sufficient_for_authority` remains false; `requires_live_github_approval` remains true.
- Create of `AUTHORIZED` / `APPROVED` / `MERGE_READY` / `MERGED` is rejected.
- No lease, handoff fabrication, GitHub write, HTTP API, or UI write buttons.

## Tests

- `node --test src/runtime/runtime.test.js`
- `node --test src/contracts/contracts-v05.test.js`
- `npm test` in `src/web-mvp/`
- Full `src/**/*.test.js` suite

## Qualifications

- Browser Web MVP still defaults to the mock catalog. Stored reads are for Node tests and future Node hosts via `App` `dataSource`.
- Newly created Tasks have an incomplete handoff chain and therefore project as `chainConsistency=invalid`. That is fail-closed, not approval.
- `risk_tier` remains absent from Task Contract v0.5.
