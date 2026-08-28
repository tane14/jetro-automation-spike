# Web MVP Contract Integration v0.6 — implementation evidence

## Scope

Laboratory repository only: `tane14/jetro-automation-spike`.

Read-only Web Control Plane now consumes canonical Task/Handoff Contracts v0.5 through an adapter. GitHub remains the system of record. This change does not approve, merge, dispatch agents, mutate approval-provenance, alter the GitHub workflow/ruleset, access VPS/production/JETRO/IBE, or treat `valid: true` as human authority.

## SHAs

- BASE_SHA (`origin/main` at branch creation, includes PR #21): `f64b688d9f28e7f159a473f6df961bcc219a65a2`
- HEAD_SHA: recorded in the commit on `cursor/web-mvp-contract-integration-v06`

## Architecture

```
Web MVP (React screens)
  → ControlPlaneDataSource
  → Contract Adapter (src/web-mvp/adapter/)
  → src/contracts/* + control-plane/contracts/v0.5 schemas
  → Authority Boundary (sufficient_for_authority=false)
```

React components do not import JSON Schema. They render a projected view model.

## Contracts consumed

- `task.schema.json` (Task Contract)
- `agent-assignment.schema.json`
- `execution.schema.json`
- `handoff-result.schema.json` (Execution Handoff)
- `review.schema.json` (Review Handoff)
- `human-approval-gate.schema.json`
- `evidence-reference.schema.json`
- `policy-check-reference.schema.json`
- `mission.schema.json`
- `src/contracts/json-schema-lite.js`, `correlation.js`, `authority.js`
- Full `validateDocument` / `validateHandoffChain` / `validateCorrelation` in Node tests

## Authority boundary

- Live GitHub PR review APPROVED + approval-provenance v0.4 remains the only human authority.
- Claude = ADVISORY.
- Cursor/executor = non-authoritative execution.
- Markdown = NON-AUTHORITATIVE.
- Evidence = REFERENCE ONLY.
- Human approval gate JSON = LIVE VERIFICATION REQUIRED (`sufficient_for_authority === false`, `requires_live_github_approval === true`).
- No execute/merge buttons.

## Tests

- `node --test src/contracts/contracts-v05.test.js`
- `node --test src/web-mvp/adapter/contractAdapter.test.js` (required v0.6 scenarios)
- `npm test` in `src/web-mvp/` (domain + adapter + vitest UI)
- Full `src/**/*.test.js` suite

## Mock scenarios

- A valid chain: TASK-20260828-001
- B Claude advisory: TASK-20260828-002
- C gate awaiting live GitHub verification: TASK-20260828-003
- D head SHA mismatch: TASK-20260828-004
- E executor/reviewer identity collision: TASK-20260828-005
- F invalid schema (missing task id): TASK-20260828-006

## Qualifications

- Mocks remain local; there is still no live GitHub data adapter.
- Risk tier is displayed as "—" because Contracts v0.5 Task Contract has no `risk_tier` field.
- UI adapter uses schema + correlation + authority modules; cryptographic contract_hash restamp is asserted in Node via the full contracts API.
