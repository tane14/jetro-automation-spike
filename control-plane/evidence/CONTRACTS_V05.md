# Contracts v0.5 — task and handoff envelopes

## Scope

Laboratory repository only: `tane14/jetro-automation-spike`.

This evidence covers versioned JSON Schema contracts under `control-plane/contracts/v0.5/` plus a fail-closed stdlib validator in `src/contracts/`.

No lease service, database, scheduler, automatic agent, HTTP API, runner, or GitHub integration runtime was built. No VPS, production, JETRO/IBE, merge, ruleset change, or approval-provenance mutation.

## Why src/ changed

`validation-evidence` requires a `control-plane/evidence/` artifact when `src/` changes. Added modules:

- `src/contracts/json-schema-lite.js` — subset JSON Schema validator
- `src/contracts/binding.js` — deterministic canonical SHA-256 contract hash
- `src/contracts/lifecycle.js` — state machine; impossible/missing transitions fail
- `src/contracts/authority.js` — executor/Claude/Markdown cannot claim human authority
- `src/contracts/correlation.js` — cross-document id/hash/self-approve rules
- `src/contracts/validate.js` — fail-closed entry point
- `src/contracts/index.js` — future API/Web Control Plane import surface
- `src/contracts/contracts-v05.test.js` — required fixture and semantic tests

These modules validate **contract shape and boundaries**. They are not an authority source. They do not interpret `lease_token` as approval. They do not treat Claude verdicts or Markdown as GitHub approval. `validateDocument()` is never sufficient for authority; review/approval chains require `validateHandoffChain()` / `validateCorrelation()`, which still do not replace live GitHub approval-provenance v0.4.

Hardening on PR #21: `claude_advisory` cannot use `verdict: APPROVED`; reviewer identity is compared to the executor regardless of declared role; `human_approval_gate.reviewed_head_sha` must match execution/review heads.

## Validation command

```
node --test src/contracts/contracts-v05.test.js
```

## Authority reminder

Approval authority remains a GitHub PR review with state `APPROVED` from an allowed human reviewer, plus existing approval-artifact binding from approval provenance v0.4. Contract JSON is evidence of structure, not approval.
