# Evidence Attestation v0.5 — implementation evidence

## Scope

Laboratory repository only: `tane14/jetro-automation-spike`.

This file is **evidence of the attestation runtime task**. It is **not** an authority artifact.
No check may treat this document, or any generated attestation JSON, as approval authority.

No JETRO/IBE, VPS, production, database, or deployment changes are covered or implied.

## Authority vs evidence

- Approval **authority** continues to be derived exclusively from **live GitHub API** data inside the `approval-provenance` job (v0.4 enforcement semantics).
- The attestation JSON is **evidence of what was observed**, emitted after the live decision is computed.
- The job does **not** checkout the PR. Attestation generation stays **inline in the workflow**, so `src/` cannot change provenance PASS/FAIL.
- Attestation JSON is published as a GitHub Actions artifact. It is **not** committed to git.
- No check reads a stored attestation to decide PASS/FAIL.

## Policy versions

- `schema_version`: `0.5`
- `policy_version`: `approval-provenance-v0.4`
- `check_name`: `approval-provenance`
- `source_system`: `github-actions`

## Enforcement preserved (v0.4)

- Live PR head SHA from GitHub API
- Paginated reviews (`per_page=100`, next-page / full-page, fail-closed, max 50 pages)
- Latest substitutive review per allowlisted reviewer using `submitted_at` + `id`
- Substitutive states: `APPROVED`, `CHANGES_REQUESTED`, `DISMISSED`
- `COMMENTED` is not substitutive
- Qualifying approval: allowlist AND latest substitutive state `APPROVED` AND `commit_id ==` current live head
- Allowlist remains `machubsystem-sketch`
- Triggers unchanged
- No `pull_request_target`

## Decision mapping

| Live observation | `decision` | Job exit |
| --- | --- | --- |
| Qualifying live `APPROVED` on current head | `APPROVED` | 0 |
| No qualifying review (none / stale / dismissed / changes requested) | `REJECTED` | 1 |
| API/runtime ambiguity or malformed review payload | `INDETERMINATE` | 1 |

Malformed review payload is mapped to **INDETERMINATE** (fail-closed). Documented cases:

- review entry is not an object
- allowlisted substitutive review missing/unparseable `submitted_at`
- allowlisted substitutive review missing usable `id`
- latest substitutive review missing `commit_id`
- reviews payload is not a list
- live PR head SHA unavailable
- reviews API / pagination failure

## Canonicalization / hash

Deterministic canonicalization with Python stdlib only:

- `json.dumps(..., sort_keys=True, separators=(',', ':'), ensure_ascii=False)`
- UTF-8
- SHA-256

This is a **JCS-compatible subset**, **not** full RFC 8785. No RFC 8785 library is used.

`evidence_hash` is SHA-256 of the canonical bytes of the attestation **excluding** `evidence_hash` and `attestation_id`. Then:

- `evidence_hash` = hex digest
- `attestation_id` = `sha256:<evidence_hash>`

The stored artifact may be pretty-printed JSON. The hash is **not** of the pretty-printed file.

## Artifact

- Name: `approval-provenance-attestation`
- File: `approval-provenance-attestation.json`
- Upload even when the evaluate step fails (`if: always()` plus step output that the file was written)
- Retention: GitHub Actions default
- Optional `GITHUB_STEP_SUMMARY` copy is evidence-only

## Qualifications

1. Job-level `actions: write` was added so `actions/upload-artifact@v4` can publish the evidence artifact. `contents` and `pull-requests` remain `read`. No secrets were added.
2. `workflow_job_id` is the Actions job id string (`GITHUB_JOB` / `approval-provenance`), not a numeric Actions backend job id (that numeric id is not in the default runner environment).
3. Fork PRs may be unable to upload artifacts under GitHub's reduced `GITHUB_TOKEN` permissions; same-repository PRs are the laboratory path.
4. The Python harness under `src/` duplicates emission/evaluation logic for tests only. The provenance job does not execute `src/`.

## Local harness

`python src/approval_provenance_attestation_test.py` (also invoked from `src/approval-provenance-attestation.test.js` via `node --test`).
