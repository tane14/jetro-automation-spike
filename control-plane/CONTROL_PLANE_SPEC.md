# Automation Control Plane v0.1

Status: DESIGN_DRAFT
Created by: ChatGPT
Scope: jetro-automation-spike laboratory only

## Purpose

Provide a governed shared-state model for coordinating ChatGPT, Claude Code, and Cursor without requiring the human operator to copy contracts or implementation context between agents.

## Core principle

GitHub is the shared control state. Agents operate only on explicitly defined contracts and states. Human approval remains mandatory for privileged or production-impacting transitions.

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
- Review implementation evidence.
- STOP on unsafe or contradictory instructions.
- Does not implement when the contract assigns implementation to Cursor.

### Cursor — Executor
- Implement only the approved contract.
- Run required validation.
- Publish implementation on a dedicated branch.
- Never merge to main or deploy production without an explicit gate.

### Human — Approval Authority
- Approves privileged transitions.
- Resolves ambiguity or blocked states.
- Authorizes production-impacting operations.

## State machine

Normal path:

DISCOVERED → PLANNED → CONTRACT_READY → HUMAN_APPROVED → EXECUTING → VALIDATING → REVIEW_READY → REVIEWED → HUMAN_APPROVAL → APPROVED → COMPLETED

Exception states:

BLOCKED, FAILED, REJECTED, ROLLED_BACK, CANCELLED

No agent may silently skip a required state.

## Mandatory evidence

Every execution must identify:

- task/contract ID
- current state
- agent
- branch
- commit
- files changed
- validation command and result
- review result
- risks/blockers
- human approval when required

Claims of success must be backed by inspectable evidence whenever possible.

## Protected operations

The following require an explicit human approval gate:

- production deployment
- database migrations
- authentication/security policy changes
- infrastructure changes
- merge to protected main/production branches
- destructive operations
- changes to real JETRO/IBE environments

## Safety boundary for v0.1

This control plane is laboratory-only. No VPS, production, JETRO/IBE databases, or live services may be accessed by laboratory tasks unless a later contract explicitly authorizes a separately approved environment transition.

## Failure policy

If a contract is contradictory, incomplete in a way that prevents safe execution, or violates a protected boundary:

1. STOP.
2. Set state to BLOCKED.
3. Record the conflict and reason.
4. Make no implementation change.
5. Request human resolution.

## Design decision

GitHub is the source of shared task state for v0.1. Branches isolate work; contracts define intent; commits provide immutable implementation evidence; reviews and approval gates govern progression.

## Next validation

Validate this specification through a minimal TASK-001 lifecycle in the same isolated repository before considering adoption for JETRO/IBE.
