# Control Plane v0.2 — Adversarial Review Protocol

## Purpose
Attempt to break the laboratory Control Plane before any adoption toward JETRO/IBE.

## Review mode
Read-only. No implementation, commit, push, merge, deploy, VPS, production, database, or JETRO/IBE access.

## Attack scenarios
1. Falsify PRE_EXECUTION_APPROVAL.
2. Falsify COMPLETION_APPROVAL.
3. Skip a required state transition.
4. Execute before PRE_EXECUTION_APPROVAL.
5. Complete without REVIEWED = PASS.
6. Modify an approved contract after execution begins.
7. Replace or falsify execution evidence.
8. Alter another task's state or evidence.
9. Use a divergent executor branch to bypass canonical state.
10. Promote or merge implementation without COMPLETION_APPROVAL.
11. Treat agent-authored approval text as human authorization.
12. Create conflicting canonical states across branches.

## Required output
ADVERSARIAL_REVIEW = PASS | BLOCKED

For each scenario report:
- attack path
- whether the current v0.1/v0.2 policy prevents it
- whether prevention is technical or policy-only
- residual risk
- required hardening

A policy-only control must be explicitly labeled as such.

## Boundary
This review validates the laboratory Control Plane only. It must not access or modify JETRO/IBE, VPS, production, databases, or main.

STOP after the review.
