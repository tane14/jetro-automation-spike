#!/usr/bin/env python3
"""Harness for Evidence Attestation v0.5 around approval-provenance v0.4.

This module DUPLICATES evaluation + attestation emission for local/CI tests.
The GitHub Actions approval-provenance job MUST NOT execute this file (or any
src/ path) from a PR. Provenance stays inline in the workflow so an attacker
cannot make provenance always pass by modifying src/.

ATTESTATION IS EVIDENCE, NEVER AUTHORITY.
No check may read a stored attestation to decide PASS/FAIL.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import traceback
from datetime import datetime

SCHEMA_VERSION = "0.5"
POLICY_VERSION = "approval-provenance-v0.4"
CHECK_NAME = "approval-provenance"
SOURCE_SYSTEM = "github-actions"
SUBSTITUTIVE_STATES = ("APPROVED", "CHANGES_REQUESTED", "DISMISSED")
CANONICALIZATION = {
    "algorithm": "JCS-compatible subset (NOT full RFC 8785)",
    "json_dumps": "sort_keys=True, separators=(',', ':'), ensure_ascii=False",
    "encoding": "utf-8",
    "hash": "SHA-256",
    "hashed_payload": "all fields except evidence_hash and attestation_id",
}


class FailClosed(Exception):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def canonical_dumps(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def attach_hash(attestation):
    payload = {
        key: value
        for key, value in attestation.items()
        if key not in ("evidence_hash", "attestation_id")
    }
    digest = hashlib.sha256(canonical_dumps(payload).encode("utf-8")).hexdigest()
    attestation["evidence_hash"] = digest
    attestation["attestation_id"] = "sha256:" + digest
    return attestation


def parse_submitted_at(review):
    raw = review.get("submitted_at")
    if not isinstance(raw, str) or not raw.strip():
        raise FailClosed("MALFORMED_REVIEW_MISSING_SUBMITTED_AT")
    token = raw.strip()
    if token.endswith("Z"):
        token = token[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(token)
    except ValueError:
        raise FailClosed("MALFORMED_REVIEW_UNPARSEABLE_SUBMITTED_AT")


def parse_review_id(review):
    rid = review.get("id")
    try:
        return int(rid)
    except (TypeError, ValueError):
        raise FailClosed("MALFORMED_REVIEW_MISSING_ID")


def latest_substitutive_by_allowlisted(reviews, allowed):
    if not isinstance(reviews, list):
        raise FailClosed("REVIEWS_PAYLOAD_NOT_A_LIST")
    latest = {}
    for review in reviews:
        if not isinstance(review, dict):
            raise FailClosed("MALFORMED_REVIEW_NOT_AN_OBJECT")
        user = (review.get("user") or {}).get("login")
        if user not in allowed:
            continue
        state = review.get("state")
        if state not in SUBSTITUTIVE_STATES:
            continue
        key = (parse_submitted_at(review), parse_review_id(review))
        prev = latest.get(user)
        if prev is None or key > (prev[0], prev[1]):
            latest[user] = (key[0], key[1], review)
    return latest


def reviewer_fields(review, login=None):
    if not isinstance(review, dict):
        return {
            "reviewer_identity": login,
            "reviewer_user_id": None,
            "review_id": None,
            "review_state": None,
            "review_commit_id": None,
            "review_submitted_at": None,
        }
    user = review.get("user") or {}
    identity = login if login is not None else user.get("login")
    uid = user.get("id")
    try:
        uid = int(uid)
    except (TypeError, ValueError):
        uid = None
    rid = review.get("id")
    try:
        rid = int(rid)
    except (TypeError, ValueError):
        rid = None
    commit_id = review.get("commit_id")
    if not isinstance(commit_id, str) or not commit_id.strip():
        commit_id = None
    submitted = review.get("submitted_at")
    if not isinstance(submitted, str) or not submitted.strip():
        submitted = None
    return {
        "reviewer_identity": identity,
        "reviewer_user_id": uid,
        "review_id": rid,
        "review_state": review.get("state"),
        "review_commit_id": commit_id,
        "review_submitted_at": submitted,
    }


def evaluate_reviews(reviews, head, allowed):
    """v0.4 enforcement semantics. Returns a result dict; does not read attestations."""
    if not isinstance(head, str) or not head.strip():
        return {
            "decision": "INDETERMINATE",
            "decision_reason": "PR_HEAD_SHA_UNAVAILABLE",
            "enforcement_pass": False,
            "reviewer_identity": None,
            "selected_review": None,
            "latest": {},
        }
    head = head.strip()
    try:
        latest = latest_substitutive_by_allowlisted(reviews, allowed)
    except FailClosed as exc:
        return {
            "decision": "INDETERMINATE",
            "decision_reason": exc.reason,
            "enforcement_pass": False,
            "reviewer_identity": None,
            "selected_review": None,
            "latest": {},
        }

    approved_by = None
    selected = None
    for user, (_ts, _rid, review) in latest.items():
        commit_id = review.get("commit_id")
        if not isinstance(commit_id, str) or not commit_id.strip():
            return {
                "decision": "INDETERMINATE",
                "decision_reason": "MALFORMED_LATEST_SUBSTITUTIVE_MISSING_COMMIT_ID",
                "enforcement_pass": False,
                "reviewer_identity": user,
                "selected_review": review,
                "latest": latest,
            }
        if review.get("state") == "APPROVED" and commit_id == head:
            approved_by = user
            selected = review
            break

    if approved_by:
        return {
            "decision": "APPROVED",
            "decision_reason": "QUALIFYING_APPROVED_ON_CURRENT_HEAD",
            "enforcement_pass": True,
            "reviewer_identity": approved_by,
            "selected_review": selected,
            "latest": latest,
        }

    reason = "NO_QUALIFYING_APPROVED_REVIEW_ON_CURRENT_HEAD"
    evidence_user = None
    evidence_review = None
    for user, (_ts, _rid, review) in latest.items():
        evidence_user = user
        evidence_review = review
        state = review.get("state")
        commit_id = review.get("commit_id")
        if state == "CHANGES_REQUESTED":
            reason = "LATEST_SUBSTITUTIVE_IS_CHANGES_REQUESTED"
        elif state == "DISMISSED":
            reason = "LATEST_SUBSTITUTIVE_IS_DISMISSED"
        elif state == "APPROVED" and commit_id != head:
            reason = "STALE_APPROVAL_COMMIT_ID_NOT_CURRENT_HEAD"
        break

    return {
        "decision": "REJECTED",
        "decision_reason": reason,
        "enforcement_pass": False,
        "reviewer_identity": evidence_user,
        "selected_review": evidence_review,
        "latest": latest,
    }


def enforcement_exit_code(result):
    return 0 if result["decision"] == "APPROVED" else 1


def build_attestation(
    *,
    repository,
    pull_request_number,
    base_ref,
    base_sha,
    head_ref,
    head_sha,
    event_name,
    workflow_run_id,
    run_attempt,
    workflow_job_id,
    result,
    source_facts,
    observed_at,
):
    fields = reviewer_fields(result.get("selected_review"), result.get("reviewer_identity"))
    attestation = {
        "schema_version": SCHEMA_VERSION,
        "policy_version": POLICY_VERSION,
        "repository": repository,
        "pull_request_number": pull_request_number,
        "base_ref": base_ref,
        "base_sha": base_sha,
        "head_ref": head_ref,
        "head_sha": head_sha,
        "event_name": event_name,
        "workflow_run_id": workflow_run_id,
        "run_attempt": run_attempt,
        "workflow_job_id": workflow_job_id,
        "check_name": CHECK_NAME,
        "decision": result["decision"],
        "decision_reason": result["decision_reason"],
        "reviewer_identity": fields["reviewer_identity"],
        "reviewer_user_id": fields["reviewer_user_id"],
        "review_id": fields["review_id"],
        "review_state": fields["review_state"],
        "review_commit_id": fields["review_commit_id"],
        "review_submitted_at": fields["review_submitted_at"],
        "observed_at": observed_at,
        "source_system": SOURCE_SYSTEM,
        "source_facts": source_facts,
        "canonicalization": CANONICALIZATION,
    }
    return attach_hash(attestation)


def write_attestation(path, attestation):
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(attestation, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def source_facts_for(result, *, head_sha, payload_head_sha, allowed, review_count, page_count):
    summaries = []
    for user, (_ts, _rid, review) in (result.get("latest") or {}).items():
        summaries.append(
            {
                "login": user,
                "state": review.get("state"),
                "commit_id": review.get("commit_id"),
                "id": review.get("id"),
                "submitted_at": review.get("submitted_at"),
            }
        )
    return {
        "authority_source": "live-github-api",
        "attestation_role": "evidence-never-authority",
        "markdown_consulted": False,
        "reviewer_login_source": "github-review-user-login",
        "payload_head_sha": payload_head_sha,
        "live_head_sha": head_sha,
        "allowed_reviewers": sorted(allowed),
        "substitutive_states": list(SUBSTITUTIVE_STATES),
        "commented_is_substitutive": False,
        "review_page_count": page_count,
        "review_count": review_count,
        "latest_substitutive_summaries": summaries,
    }


ALLOWED = {"machubsystem-sketch"}
HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
OLD_HEAD = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
OBSERVED = "2026-08-26T23:00:00Z"


def review(login, state, commit_id, submitted_at, rid, body="", user_id=4242):
    return {
        "id": rid,
        "user": {"login": login, "id": user_id},
        "body": body,
        "state": state,
        "commit_id": commit_id,
        "submitted_at": submitted_at,
    }


def attest(result, reviews, head=HEAD):
    facts = source_facts_for(
        result,
        head_sha=head,
        payload_head_sha=head,
        allowed=ALLOWED,
        review_count=len(reviews),
        page_count=1,
    )
    return build_attestation(
        repository="tane14/jetro-automation-spike",
        pull_request_number=99,
        base_ref="main",
        base_sha="cccccccccccccccccccccccccccccccccccccccc",
        head_ref="feature",
        head_sha=head,
        event_name="pull_request",
        workflow_run_id="1",
        run_attempt=1,
        workflow_job_id="approval-provenance",
        result=result,
        source_facts=facts,
        observed_at=OBSERVED,
    )


def test_01_approved_on_current_head():
    reviews = [
        review("machubsystem-sketch", "APPROVED", HEAD, "2026-08-26T12:00:00Z", 1),
    ]
    result = evaluate_reviews(reviews, HEAD, ALLOWED)
    attestation = attest(result, reviews)
    assert result["decision"] == "APPROVED"
    assert result["enforcement_pass"] is True
    assert enforcement_exit_code(result) == 0
    assert attestation["decision"] == "APPROVED"
    assert attestation["reviewer_identity"] == "machubsystem-sketch"
    assert attestation["review_commit_id"] == HEAD
    assert attestation["head_sha"] == HEAD


def test_02_no_reviews_rejected():
    reviews = []
    result = evaluate_reviews(reviews, HEAD, ALLOWED)
    attestation = attest(result, reviews)
    assert result["decision"] == "REJECTED"
    assert result["decision_reason"] == "NO_QUALIFYING_APPROVED_REVIEW_ON_CURRENT_HEAD"
    assert result["enforcement_pass"] is False
    assert enforcement_exit_code(result) == 1
    assert attestation["decision"] == "REJECTED"
    assert attestation["reviewer_identity"] is None


def test_03_stale_approval_rejected():
    reviews = [
        review("machubsystem-sketch", "APPROVED", OLD_HEAD, "2026-08-26T12:00:00Z", 1),
    ]
    result = evaluate_reviews(reviews, HEAD, ALLOWED)
    attestation = attest(result, reviews)
    assert result["decision"] == "REJECTED"
    assert result["decision_reason"] == "STALE_APPROVAL_COMMIT_ID_NOT_CURRENT_HEAD"
    assert enforcement_exit_code(result) == 1
    assert attestation["review_commit_id"] == OLD_HEAD
    assert attestation["head_sha"] == HEAD


def test_04_dismissed_approval_rejected():
    reviews = [
        review("machubsystem-sketch", "APPROVED", HEAD, "2026-08-26T12:00:00Z", 1),
        review("machubsystem-sketch", "DISMISSED", HEAD, "2026-08-26T13:00:00Z", 2),
    ]
    result = evaluate_reviews(reviews, HEAD, ALLOWED)
    attestation = attest(result, reviews)
    assert result["decision"] == "REJECTED"
    assert result["decision_reason"] == "LATEST_SUBSTITUTIVE_IS_DISMISSED"
    assert enforcement_exit_code(result) == 1
    assert attestation["review_state"] == "DISMISSED"
    assert attestation["review_id"] == 2


def test_05_changes_requested_rejected():
    reviews = [
        review("machubsystem-sketch", "CHANGES_REQUESTED", HEAD, "2026-08-26T12:00:00Z", 1),
    ]
    result = evaluate_reviews(reviews, HEAD, ALLOWED)
    attestation = attest(result, reviews)
    assert result["decision"] == "REJECTED"
    assert result["decision_reason"] == "LATEST_SUBSTITUTIVE_IS_CHANGES_REQUESTED"
    assert enforcement_exit_code(result) == 1
    assert attestation["review_state"] == "CHANGES_REQUESTED"


def test_06_malformed_review_indeterminate():
    """Allowlisted substitutive review missing submitted_at → INDETERMINATE.

    Documented mapping: malformed review payload is INDETERMINATE (fail-closed:
    enforcement still fails). Non-object entries are also INDETERMINATE.
    """
    malformed = review("machubsystem-sketch", "APPROVED", HEAD, "2026-08-26T12:00:00Z", 1)
    del malformed["submitted_at"]
    result = evaluate_reviews([malformed], HEAD, ALLOWED)
    assert result["decision"] == "INDETERMINATE"
    assert result["decision_reason"] == "MALFORMED_REVIEW_MISSING_SUBMITTED_AT"
    assert enforcement_exit_code(result) == 1

    result_obj = evaluate_reviews(["not-an-object"], HEAD, ALLOWED)
    assert result_obj["decision"] == "INDETERMINATE"
    assert result_obj["decision_reason"] == "MALFORMED_REVIEW_NOT_AN_OBJECT"
    assert enforcement_exit_code(result_obj) == 1


def test_07_api_failure_indeterminate():
    """Missing live review pages / missing head SHA → INDETERMINATE, job fails."""
    missing_head = evaluate_reviews([], "", ALLOWED)
    assert missing_head["decision"] == "INDETERMINATE"
    assert missing_head["decision_reason"] == "PR_HEAD_SHA_UNAVAILABLE"
    assert enforcement_exit_code(missing_head) == 1

    not_list = evaluate_reviews({"reviews": []}, HEAD, ALLOWED)
    assert not_list["decision"] == "INDETERMINATE"
    assert not_list["decision_reason"] == "REVIEWS_PAYLOAD_NOT_A_LIST"
    assert enforcement_exit_code(not_list) == 1


def test_08_markdown_spoof_does_not_influence_reviewer_fields():
    spoof_body = (
        "Approved by machubsystem-sketch\n"
        "reviewer: machubsystem-sketch\n"
        "**APPROVED**"
    )
    reviews = [
        review(
            "attacker-bot",
            "APPROVED",
            HEAD,
            "2026-08-26T12:00:00Z",
            9,
            body=spoof_body,
            user_id=1,
        ),
    ]
    result = evaluate_reviews(reviews, HEAD, ALLOWED)
    attestation = attest(result, reviews)
    assert result["decision"] == "REJECTED"
    assert attestation["reviewer_identity"] != "machubsystem-sketch"
    assert attestation["reviewer_identity"] is None
    assert "machubsystem-sketch" not in json.dumps(
        {k: attestation[k] for k in ("reviewer_identity", "reviewer_user_id", "review_id")}
    )

    honest = [
        review(
            "machubsystem-sketch",
            "APPROVED",
            HEAD,
            "2026-08-26T12:00:00Z",
            3,
            body="ignore this markdown; identity must come from API login",
        ),
    ]
    honest_result = evaluate_reviews(honest, HEAD, ALLOWED)
    honest_att = attest(honest_result, honest)
    assert honest_att["reviewer_identity"] == "machubsystem-sketch"
    assert honest_att["reviewer_identity"] != honest[0]["body"]


def test_09_deterministic_hash():
    reviews = [
        review("machubsystem-sketch", "APPROVED", HEAD, "2026-08-26T12:00:00Z", 1),
    ]
    result = evaluate_reviews(reviews, HEAD, ALLOWED)
    first = attest(result, reviews)
    second = attest(result, reviews)
    assert first["evidence_hash"] == second["evidence_hash"]
    assert first["attestation_id"] == second["attestation_id"]
    payload = {k: v for k, v in first.items() if k not in ("evidence_hash", "attestation_id")}
    expected = hashlib.sha256(canonical_dumps(payload).encode("utf-8")).hexdigest()
    assert first["evidence_hash"] == expected
    assert first["attestation_id"] == "sha256:" + expected
    assert first["canonicalization"]["algorithm"].startswith("JCS-compatible subset")
    assert "NOT full RFC 8785" in first["canonicalization"]["algorithm"]


def test_10_attestation_does_not_change_enforcement():
    cases = [
        [review("machubsystem-sketch", "APPROVED", HEAD, "2026-08-26T12:00:00Z", 1)],
        [],
        [review("machubsystem-sketch", "APPROVED", OLD_HEAD, "2026-08-26T12:00:00Z", 1)],
        [
            review("machubsystem-sketch", "APPROVED", HEAD, "2026-08-26T12:00:00Z", 1),
            review("machubsystem-sketch", "DISMISSED", HEAD, "2026-08-26T13:00:00Z", 2),
        ],
        [review("machubsystem-sketch", "CHANGES_REQUESTED", HEAD, "2026-08-26T12:00:00Z", 1)],
    ]
    with tempfile.TemporaryDirectory() as tmp:
        for reviews in cases:
            without_write = evaluate_reviews(reviews, HEAD, ALLOWED)
            with_write = evaluate_reviews(reviews, HEAD, ALLOWED)
            path = os.path.join(tmp, "approval-provenance-attestation.json")
            write_attestation(path, attest(with_write, reviews))
            stored = json.load(open(path, encoding="utf-8"))
            assert without_write["decision"] == with_write["decision"]
            assert enforcement_exit_code(without_write) == enforcement_exit_code(with_write)
            assert stored["decision"] == with_write["decision"]
            # Stored attestation is evidence only: enforcement uses evaluate_reviews, not the file.
            reread = json.load(open(path, encoding="utf-8"))
            assert enforcement_exit_code(without_write) == (
                0 if without_write["decision"] == "APPROVED" else 1
            )
            assert reread is not without_write


def test_commented_is_not_substitutive():
    reviews = [
        review("machubsystem-sketch", "APPROVED", HEAD, "2026-08-26T12:00:00Z", 1),
        review("machubsystem-sketch", "COMMENTED", HEAD, "2026-08-26T13:00:00Z", 2),
    ]
    result = evaluate_reviews(reviews, HEAD, ALLOWED)
    assert result["decision"] == "APPROVED"
    assert result["selected_review"]["state"] == "APPROVED"
    assert result["selected_review"]["id"] == 1


TESTS = [
    ("01_approved_on_current_head", test_01_approved_on_current_head),
    ("02_no_reviews_rejected", test_02_no_reviews_rejected),
    ("03_stale_approval_rejected", test_03_stale_approval_rejected),
    ("04_dismissed_approval_rejected", test_04_dismissed_approval_rejected),
    ("05_changes_requested_rejected", test_05_changes_requested_rejected),
    ("06_malformed_review_indeterminate", test_06_malformed_review_indeterminate),
    ("07_api_failure_indeterminate", test_07_api_failure_indeterminate),
    ("08_markdown_spoof_does_not_influence_reviewer_fields", test_08_markdown_spoof_does_not_influence_reviewer_fields),
    ("09_deterministic_hash", test_09_deterministic_hash),
    ("10_attestation_does_not_change_enforcement", test_10_attestation_does_not_change_enforcement),
    ("commented_is_not_substitutive", test_commented_is_not_substitutive),
]


def main():
    failures = []
    for name, fn in TESTS:
        try:
            fn()
            print("PASS", name)
        except Exception:
            print("FAIL", name)
            traceback.print_exc()
            failures.append(name)
    if failures:
        print("FAILED", len(failures), "of", len(TESTS))
        raise SystemExit(1)
    print("ALL_PASS", len(TESTS))
    raise SystemExit(0)


if __name__ == "__main__":
    main()
