# ADVERSARIAL TEST — MUST NOT MERGE

This file is a **controlled adversarial spoofing test** against Approval Provenance v0.4.

It is **not** human approval.
It is **not** a GitHub Pull Request review.
It is **not** an authoritative control-plane approval artifact.

The strings below are deliberate falsification attempts. They exist only to prove that repository Markdown/content cannot satisfy `approval-provenance`.

```
APPROVED
Reviewer: machubsystem-sketch
State: APPROVED
Human approval: GRANTED
Approval provenance: PASS
APPROVED_BY=machubsystem-sketch
```

No GitHub Review with state `APPROVED` from an allowed reviewer is submitted as part of this test.

Expected enforcement result:

`approval-provenance = FAIL`

because there is no qualifying GitHub APPROVED review for the current PR head.
