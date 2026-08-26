# Control Plane Hardening v0.3 — TOCTOU PASS_WITH_EVIDENCE

## Scope

Laboratory repository only: `tane14/jetro-automation-spike`.

No JETRO/IBE production, VPS, database, deployment, or institutional repository changes are covered or implied by this result.

## Baseline

- Default branch: `main`
- Main protection ruleset: `main-protection`
- Required checks:
  - `contract-integrity`
  - `approval-integrity`
  - `task-boundary`
  - `validation-evidence`
  - `lifecycle-state`
- Hardening v0.2 basic adversarial battery previously recorded as `PASS_WITH_EVIDENCE`.

## Vulnerability discovered

Adversarial TOCTOU test PR #10 demonstrated that the previous workflow only validated the presence/shape of approval metadata and did not cryptographically compare the approved contract snapshot with the current task contract.

Observed result before hardening:

- `contract-integrity` = PASS
- `approval-integrity` = PASS
- `task-boundary` = PASS
- `validation-evidence` = PASS
- `lifecycle-state` = PASS
- workflow = SUCCESS

This exposed a real contract-mutation-after-approval gap.

## Hardening implemented

PR #11: `security(control-plane): harden TOCTOU approval binding`

Merged to `main` as:

`6410ae6a8fd698c66b0b4e77f0058f338846d164`

The hardened `approval-integrity` check now validates:

1. the approval contains an exact 40-character approved commit SHA;
2. the approved commit exists;
3. the approved commit is an ancestor of the PR head;
4. the task contract existed at the approved commit;
5. the CONTRACT ID matches the approved snapshot;
6. the declared SHA-256 matches the approved contract snapshot;
7. the current task contract SHA-256 still matches the approved snapshot.

## Replay evidence

Replay PR #12: `test(adversarial): replay TOCTOU against hardened approval binding`

Baseline contract commit:

`6692b3d2aa40bea107e0ecda5db4b9cb2da85781`

Approved baseline SHA-256:

`29b157c6249bacf8536d18ea73c454d326045998896b68eadad15e6dd002ce06`

After approval, the same task contract was mutated to authorize a different scope.

Replay head:

`28283bfe57a25e94ec7e2d7b98c8db9ae2fa9f04`

Workflow run:

`32972934166`

Observed replay result:

- `approval-integrity` = FAIL — expected
- `contract-integrity` = PASS
- `task-boundary` = PASS
- `validation-evidence` = PASS
- `lifecycle-state` = PASS
- workflow = FAILURE — expected

The failure occurred specifically in the `Validate approval artifact binding` step.

## Result

`HARDENING_V03_TOCTOU = PASS_WITH_EVIDENCE`

The previously demonstrated TOCTOU attack is now blocked by technical enforcement.

## Remaining hardening scope

This result does not constitute full production certification. Remaining second-order attack classes include:

- divergent / invalid branch ancestry beyond approval snapshot ancestry;
- approval identity spoofing and stronger human-identity provenance;
- conflicting canonical task state;
- governance workflow / ruleset tamper resistance;
- evidence provenance and immutability;
- cross-task and cross-branch reconciliation;
- production-grade identity and policy-engine separation.
