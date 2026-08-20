# Automation Control Plane v0.2

Status: HARDENING_DRAFT
Created by: ChatGPT
Scope: jetro-automation-spike laboratory only

## Purpose

Provide a governed online shared-state model for coordinating ChatGPT, Claude Code, and Cursor without requiring the human operator to copy contracts or implementation context between agents.

## Core principle

GitHub is the online shared control plane, but repository content is not authorization by itself. Contracts, approvals, state, evidence, and implementation must be cryptographically/immutably bound where possible and technically protected where GitHub enforcement is available. Human approval remains mandatory for privileged or production-impacting transitions.

## Trust model

- Contract content is untrusted until validated and approved.
- A writable branch never constitutes authorization.
- Agent-authored claims of human approval are never proof.
- Approval must bind to the exact approved Contract ID, contract commit SHA, and contract content hash.
- Completion approval must bind to a distinct reviewer artifact and reviewed commit.
- Evidence must identify the exact implementation commit and validation evidence.
- Any governance artifact mutation after approval invalidates the affected gate until re-approved.

## Roles

### ChatGPT — Orchestrator
- Discover and prioritize work.
- Create task contracts and handoffs.
- Coordinate agents.
- Consolidate evidence and determine the next permitted gate.
- Never infer approval for privileged operations.

### Claude Code — Architect / Reviewer
- Validate contracts for completeness and contradictions.
- Produce implementation handoffs when authorized.
- Review implementation evidence independently.
- STOP on unsafe or contradictory instructions.
- Must not implement repository changes in the Control Plane workflow unless this specification is explicitly revised through a human-approved Control Plane change.

### Cursor — Executor
- Implement only the approved contract.
- Run required validation.
- Publish implementation on a dedicated task branch.
- May write implementation paths and its own execution evidence only.
- Never write approval artifacts or canonical task state.
- Never merge to main or deploy production without an explicit gate.

### Human — Approval Authority
- Approves privileged transitions through a designated GitHub identity/review mechanism.
- Resolves ambiguity or blocked states.
- Authorizes production-impacting operations.

## Task identity and canonical ledger

Every governed task receives a unique immutable Task ID `TASK-YYYYMMDD-NNN` and exactly one Contract ID `CONTRACT-YYYYMMDD-NNN`.

Each Task has one canonical online ledger under:

`control-plane/tasks/<TASK-ID>/`

The canonical ledger contains the current state, immutable contract reference, approved contract commit SHA/hash, executor branch/head, review reference, and approval references. Agent branches are execution workspaces, not alternate sources of truth.

Conflicting records for the same Task ID automatically result in `BLOCKED` until the Human Approval Authority resolves the conflict.

## State machine

Normal path:

DISCOVERED → PLANNED → CONTRACT_READY → PRE_EXECUTION_APPROVAL → EXECUTING → VALIDATING → REVIEW_READY → REVIEWED → COMPLETION_APPROVAL → APPROVED → COMPLETED

Exception transitions:

- Any state before COMPLETED may transition to BLOCKED when safe execution cannot continue.
- EXECUTING or VALIDATING may transition to FAILED when execution or required validation fails.
- REVIEW_READY or REVIEWED may transition to REJECTED when review does not approve the implementation.
- COMPLETED may transition to ROLLED_BACK only through an explicit human-approved rollback procedure.
- DISCOVERED, PLANNED, CONTRACT_READY, or BLOCKED may transition to CANCELLED only through human decision.
- BLOCKED returns only to the specific prior actionable state after its recorded blocker has been resolved and the required gate is re-established.
- FAILED returns to PLANNED only after a new/amended contract is recorded, hashed, reviewed, and approved.
- REJECTED returns to PLANNED only after the rejection reason is addressed through a new/amended contract, hashed, reviewed, and approved.

No agent may silently skip a required state.

## Risk tiers

- T0 — documentation/read-only laboratory work.
- T1 — isolated laboratory implementation with no external systems or production impact.
- T2 — development/staging changes or reversible operations; explicit human approval required before execution.
- T3 — production, security, database, infrastructure, destructive, or irreversible operations; explicit human approval required before execution and before completion.

Risk tier never bypasses evidence, review, or canonical state requirements.

## Contract integrity

Before PRE_EXECUTION_APPROVAL, the contract is committed to GitHub. The approval artifact must record:

- Task ID
- Contract ID
- contract commit SHA
- contract content SHA-256
- risk tier
- decision
- approver identity
- timestamp
- rationale

Any change to the approved contract path, commit, or content hash after approval invalidates PRE_EXECUTION_APPROVAL and forces the task to BLOCKED pending re-review and re-approval.

## Human approval model

For laboratory v0.2, approval artifacts remain a recorded control-plane mechanism, but they are not considered technically trustworthy until GitHub access controls verify that the designated human identity authored/approved the record. Agent-authored approval text is never sufficient.

For T2/T3, approval must be represented by an actual GitHub review/approval or equivalent external identity-bound signal that can be independently queried. A plain file claiming approval is insufficient.

## Evidence integrity

Evidence is stored under `control-plane/evidence/<TASK-ID>/` and is immutable after publication by policy. A correction creates a new evidence record referencing the prior record; historical records are never overwritten.

Every execution evidence record must bind to:

- Task ID
- Contract ID
- approved contract commit SHA/hash
- risk tier
- agent
- branch
- implementation commit
- files changed
- validation command
- validation result
- machine-verifiable CI/test run when available
- review reference
- approval references

Reviewers must independently inspect the implementation commit and, where feasible, independently re-run the validation command. A free-text claim of test success is not equivalent to a CI/test result.

## Branch ancestry and executor binding

Before REVIEW_READY is accepted, the Reviewer or CI must verify that the executor branch contains the approved contract ancestry and that the implementation commit descends from the canonical handoff/approval point according to the Task ledger.

A divergent executor branch that cannot prove ancestry to the approved Task state is BLOCKED.

## Agent write boundaries

The intended v0.2 path ownership is:

- ChatGPT: task/contract orchestration paths; cannot author approval decisions on behalf of the human.
- Claude: handoff and reviewer evidence paths; cannot modify implementation or approval paths.
- Cursor: implementation/test paths and `cursor-execution.md`; cannot modify contracts, canonical state, approvals, or other agents' evidence.
- Human-controlled governance: approvals and final canonical state transitions.

Technical enforcement should be implemented with CODEOWNERS, required reviews, branch protection, and CI path checks. Repository policy is not considered technical enforcement until the GitHub settings/status checks are actually confirmed.

## Protected operations

The following require explicit human approval:

- production deployment
- database migrations
- authentication/security policy changes
- infrastructure changes
- merge to protected main/production branches
- destructive operations
- changes to real JETRO/IBE environments

`main` must have direct pushes disabled and required human review/status checks enabled before any T2/T3 adoption.

## Canonical state and conflict resolution

The Task ledger is the sole canonical state for each Task ID. Agent branch files are supporting evidence only.

If two branches or artifacts assert incompatible states, the Task enters BLOCKED. No agent may choose the preferred state. Resolution requires a human decision recorded through the designated approval mechanism.

## Online operation

The Control Plane is online and GitHub-centered. Agents consume and publish state through the connected GitHub integration; local clones are execution workspaces only. No manual copy/paste of contracts or implementation context is required for the normal workflow.

## Failure policy

If a contract is contradictory, incomplete, mutated after approval, ancestry cannot be verified, evidence integrity cannot be established, approval cannot be authenticated, or a protected boundary is violated:

1. STOP.
2. Set canonical Task state to BLOCKED.
3. Record the reason in immutable evidence.
4. Make no implementation change.
5. Request human resolution.

## Readiness rule

v0.2 is not eligible for JETRO/IBE adoption until the technical controls are verified in GitHub settings and a second lifecycle proves the hardened state model.

## Next validation

Run the adversarial review again against this hardened specification, then execute a second T1 laboratory lifecycle using the canonical ledger and technical enforcement checks.
