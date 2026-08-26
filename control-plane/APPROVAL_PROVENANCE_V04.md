# Approval Provenance v0.4

## Purpose

Define the next hardening layer for human approval authority in the JETRO Control Plane laboratory.

## Problem

An approval Markdown artifact can prove contract binding, commit ancestry, and snapshot integrity, but the file content alone does not prove that a human authority actually approved the action. A write-capable agent could otherwise create text that resembles a human approval.

## Authority model

The primary source of human approval authority SHALL be a real GitHub Pull Request review with state `APPROVED` from an allowed human reviewer identity.

The repository artifact under `control-plane/approvals/` SHALL be treated as derived evidence and binding metadata, not as the authority source by itself.

## Required provenance

A promotion-capable lifecycle shall require all of the following:

1. A GitHub PR review with state `APPROVED`.
2. The reviewer login must be in the explicitly allowed human reviewer set for the laboratory.
3. The approval must apply to the current reviewable PR head, or be invalidated after a new push by repository rules.
4. The repository approval artifact must bind TASK ID, CONTRACT ID, approved commit SHA, and contract SHA-256.
5. Approval artifact binding must continue to pass TOCTOU and ancestry validation.
6. Agent-authored text such as `Approved by Human` or equivalent SHALL NOT satisfy authority provenance.

## Laboratory allowed reviewer identity

For the current isolated laboratory only, the independently authenticated reviewer identity used for governance testing is:

- `machubsystem-sketch`

This is a laboratory identity policy and is not a production identity model.

## Enforcement direction

GitHub repository rules already require one approving review, CODEOWNER review where applicable, dismissal of stale reviews after new pushes, approval of the most recent reviewable push, conversation resolution, and required status checks.

The next automated provenance check should query or otherwise verify GitHub review metadata rather than trusting Markdown claims. Until that verification is implemented in CI, approval provenance is classified as partially enforced by GitHub branch rules and not fully cryptographically attested by the repository workflow.

## Status

`APPROVAL_PROVENANCE_V04 = DESIGN_READY_FOR_ENFORCEMENT`

No JETRO/IBE, VPS, production, database, or deployment changes are covered or implied by this document.
