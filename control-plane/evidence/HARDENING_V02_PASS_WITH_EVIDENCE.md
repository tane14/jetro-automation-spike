# Control Plane Hardening v0.2 — PASS_WITH_EVIDENCE

## Scope

Laboratory repository only: `tane14/jetro-automation-spike`.

No JETRO/IBE production, VPS, database, or deployment changes are covered or implied by this result.

## Baseline

- Default branch: `main`
- Control Plane workflow merged to `main` via PR #2
- Workflow file: `.github/workflows/control-plane-checks.yml`
- Main workflow merge commit: `66ccdc93a460fbd7dd7311f650a08e332832ede7`
- Required checks enforced by the active `main-protection` ruleset:
  - `contract-integrity`
  - `approval-integrity`
  - `task-boundary`
  - `validation-evidence`
  - `lifecycle-state`

## Adversarial Evidence

### Test #1 — task-boundary

- PR: #3
- Head commit: `70184bc1845123ac36aebaaad744ae6548d7648b`
- Attack: change outside allowed laboratory paths (`forbidden-boundary.txt`)
- Workflow run: `32965024505`
- Expected: `task-boundary = failure`
- Observed:
  - `task-boundary` = FAILURE
  - `contract-integrity` = SUCCESS
  - `approval-integrity` = SUCCESS
  - `validation-evidence` = SUCCESS
  - `lifecycle-state` = SUCCESS
- Result: PASS — invalid boundary was blocked.

### Test #2 — approval-integrity

- PR: #5
- Head commit: `b81d87cff17e3cba8d6d859e1491f729b501f3cd`
- Attack: approval artifact missing approved commit SHA and contract hash marker
- Workflow run: `32969275648`
- Expected: `approval-integrity = failure`; `contract-integrity` may also fail
- Observed:
  - `approval-integrity` = FAILURE
  - `contract-integrity` = FAILURE
  - `task-boundary` = SUCCESS
  - `validation-evidence` = SUCCESS
  - `lifecycle-state` = SUCCESS
- Result: PASS — malformed approval was blocked.

### Test #3 — validation-evidence

- PR: #6
- Head commit: `7d437f81b98349a13494aeb4f58edf3d8be493ab`
- Attack: code change under `src/` without corresponding evidence artifact
- Workflow run: `32969489774`
- Expected: `validation-evidence = failure`
- Observed:
  - `validation-evidence` = FAILURE
  - `contract-integrity` = SUCCESS
  - `approval-integrity` = SUCCESS
  - `task-boundary` = SUCCESS
  - `lifecycle-state` = SUCCESS
- Result: PASS — code without evidence was blocked.

### Test #4 — lifecycle-state

- PR: #7
- Head commit: `b4c8c1fb0a87ec88ffdac84c779c5e281e0a78aa`
- Attack: completion evidence without required completion approval artifact
- Workflow run: `32969774935`
- Expected: `lifecycle-state = failure`
- Observed:
  - `lifecycle-state` = FAILURE
  - `contract-integrity` = SUCCESS
  - `approval-integrity` = SUCCESS
  - `task-boundary` = SUCCESS
  - `validation-evidence` = SUCCESS
- Result: PASS — invalid lifecycle completion was blocked.

### Test #5 — contract-integrity

- PR: #8
- Head commit: `9e475283f786c2abf0178c6b0a2a860f607373fd`
- Attack: task artifact with valid TASK ID but missing required CONTRACT ID
- Workflow run: `32970272419`
- Expected: `contract-integrity = failure`
- Observed:
  - `contract-integrity` = FAILURE
  - `approval-integrity` = SUCCESS
  - `task-boundary` = SUCCESS
  - `validation-evidence` = SUCCESS
  - `lifecycle-state` = SUCCESS
- Result: PASS — malformed task/contract artifact was blocked.

## Result

`HARDENING_V02 = PASS_WITH_EVIDENCE`

The first enforcement battery proved that each required Control Plane check can independently reject a targeted invalid change while unrelated checks remain green where applicable.

This result demonstrates repository-level enforcement for the tested controls. It does **not** yet certify resistance to all higher-order governance attacks.

## Remaining Hardening Scope

The next adversarial battery should cover at minimum:

1. approval/contract TOCTOU — approve contract A, execute mutated contract B;
2. branch ancestry — executor branch must descend from the exact approved contract commit;
3. approval spoofing / reviewer identity boundary;
4. canonical-state conflicts across divergent branches;
5. cross-task mutation in one PR;
6. evidence-to-commit provenance and CI run binding;
7. workflow/ruleset tampering attempts;
8. protection of governance changes themselves.

Until those are closed, v0.2 should be treated as `PASS_WITH_EVIDENCE`, not as full production certification.
