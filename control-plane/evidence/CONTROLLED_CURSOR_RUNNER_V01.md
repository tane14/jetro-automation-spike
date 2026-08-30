# ControlledCursorRunner v0.1 — implementation evidence

## Classification

- RISK_TIER=T1
- ENVIRONMENT=LAB_ONLY
- SECURITY_BOUNDARY=NO

This runner is **not** a security boundary. It is **not** authorized for production, VPS, JETRO-IBE, AWS, databases, secrets, T2, or T3.

## Role

Adapter/runtime capability only. It executes an **already-authorized** request.

- PreExecutionGateRuntime remains start-authorization authority via `evaluateStartAuthorization`.
- Policy / gate `allowed === true` is **not** GitHub approval (`sufficient_for_authority` stays false).
- The runner never advances Task lifecycle.
- The runner is **not** the Evidence Ledger. It returns hash-bound evidence *data* only.
- Agent text (including "done", "APPROVED", or `BOUNDARY_VALIDATED`) cannot authorize task completion.

## Invocation (Windows LAB)

When trust is valid for the **exact** workspace:

```
agent.cmd --print --output-format json --mode ask --workspace <AUTHORIZED_WORKSPACE> --trust -- <prompt>
```

`--trust` is never injected silently. `--force`, `--yolo`, and `--approve-mcps` are never emitted.

## Exit status

Process exit is captured from the child process `close` code. Classification keeps three independent axes:

- PROCESS_EXIT_STATUS
- CLI_PROTOCOL_STATUS
- AGENT_RESULT (text payload, not authority)

`is_error=false` or JSON `subtype=success` is never sufficient for lifecycle success.

## Timeout

External timeout (default 180000 ms). On timeout: terminate, `timedOut=true`, preserve captured stdout/stderr, **no retry**.

## Tests

`node --test src/runtime/controlledCursorRunner.test.js`
