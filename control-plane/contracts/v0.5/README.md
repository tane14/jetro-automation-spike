# Control Plane contracts v0.5

Versioned JSON Schema contracts for structured, machine-readable communication:

ChatGPT Orchestrator → Cursor Executor → Claude Reviewer → Human Authority

This directory is the **contract base**. It does not implement a lease service, database, scheduler, automatic agent, HTTP API, runner, or GitHub integration runtime. It does not merge pull requests and does not change GitHub approval provenance or repository rulesets.

Validation uses a small Node stdlib stack under `src/contracts/` (`json-schema-lite.js` plus fail-closed semantic checks). No extra packages.

## Documents

| Kind | Schema | Source → target |
| --- | --- | --- |
| Task Contract | `task.schema.json` | orchestrator → executor |
| Execution Handoff | `handoff-result.schema.json` | executor → reviewer |
| Review Handoff | `review.schema.json` | reviewer → human_authority |
| Human Approval Gate | `human-approval-gate.schema.json` | derived record of GitHub PR review |
| Evidence reference | `evidence-reference.schema.json` | reference only |
| Policy/check reference | `policy-check-reference.schema.json` | reference only |
| Lifecycle transition | `lifecycle-transition.schema.json` | recorded state change |
| Mission / assignment / execution | supporting envelopes | not authority |

Every Task Contract has a stable `task_id` (`TASK-YYYYMMDD-NNN`), `schema_version: "0.5"`, and a deterministic `contract_hash` (SHA-256 of canonical JSON with `contract_hash` excluded). Child documents copy that hash; they do not become a second authority source.

## Authority boundaries

| Artifact | What it is | What it is not |
| --- | --- | --- |
| Task Contract | Correlated task/contract record and lifecycle state | GitHub approval, merge right, or lease authority |
| Execution Handoff | Executor-submitted outcome (`source_role`/`target_role`) | Human authority |
| Review Handoff | Advisory (Claude) or derived GitHub record | Live GitHub approval |
| Human Approval Gate | Derived record that a GitHub PR review `APPROVED` exists | The approval itself |
| Evidence reference | Audit pointer | Authoritative input |
| Markdown file | Human-readable evidence | Authority |
| Policy/check reference | Pointer to existing CI/policy | A second approval path |

Rules:

- `authority_claim` is always `"none"` on these documents.
- Executor cannot transform a handoff into human authority.
- Claude review remains advisory (`verdict_kind: claude_advisory`, `authority_rank: advisory`).
- Human approval remains explicitly authoritative **only** via the existing GitHub mechanism (approval-provenance v0.4: live PR review `APPROVED` from an allowed human).
- Markdown does not grant authority. `authority_source` for the gate is `github_pr_review` only.
- Evidence is referencable (`input_role: reference_only`) and never authoritative input.
- Handoffs record `source_role` and `target_role`. Invalid pairs fail closed.
- Lifecycle transitions reject missing or impossible states.
- `lease_token` is opaque. Validators must not interpret it as authorization.

`AUTHORIZED` / `APPROVED` / `MERGE_READY` / `MERGED` on a Task Contract are **recorded states**, not proof of GitHub approval.

## Evidence vs authority

- **Evidence** is an audit record. It can be true, incomplete, or self-serving.
- **Authority** for approval is a GitHub PR review `APPROVED` from an allowed human identity, bound to the reviewable head, plus existing approval-artifact binding from approval provenance v0.4.
- These v0.5 schemas **do not weaken** that model and do not introduce a second approval path.

## Correlation and binding

Identifiers correlate by explicit fields, not by assuming date/sequence suffixes match.

Required: `mission_id`, `task_id`, `contract_id` copied onto children. `contract_hash` copied from the Task Contract. Handoff references `execution_id`. Published review `reviewed_head_sha` must equal handoff `head_sha`. Executor identity must not equal `github_approver` / gate `reviewer_identity`.

## Lifecycle

Impossible or missing transitions fail closed. See `src/contracts/lifecycle.js`.

Retry of an execution **creates a new `execution_id`**. A task may have only one active lease (`LEASED` or `RUNNING`).

## Versioning

- Path: `control-plane/contracts/v0.5/`
- Every document sets `"schema_version": "0.5"`.
- Breaking changes MUST add `v0.6/` (or later).

## Tests

From the repository root (Node stdlib only):

```
node --test src/contracts/contracts-v05.test.js
```

Invalid documents fail closed. Markdown, executor, and Claude cannot claim human authority.

## Future API / Web Control Plane

`src/contracts/index.js` is the intended import surface for a future read-mostly control plane. It is not an HTTP API and does not reimplement GitHub authority. The existing Web MVP remains a separate read-only projection.
