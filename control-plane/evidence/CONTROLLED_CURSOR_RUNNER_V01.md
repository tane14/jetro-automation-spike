# ControlledCursorRunner v0.1 / v0.1.1 — implementation evidence

## Classification

- RISK_TIER=T1
- ENVIRONMENT=LAB_ONLY
- SECURITY_BOUNDARY=NO
- WINDOWS_DESCENDANT_TERMINATION_GUARANTEE=NO

This runner is **not** a security boundary. It is **not** authorized for production, VPS, JETRO-IBE, AWS, databases, secrets, T2, or T3.

## Role

Adapter/runtime capability only. It executes an **already-authorized** request.

- PreExecutionGateRuntime remains start-authorization authority via `evaluateStartAuthorization`.
- Policy / gate `allowed === true` is **not** GitHub approval (`sufficient_for_authority` stays false).
- The runner never advances Task lifecycle.
- The runner is **not** the Evidence Ledger. It returns hash-bound evidence *data* only.
- Agent text (including "done", "APPROVED", or `BOUNDARY_VALIDATED`) cannot authorize task completion.

## v0.1.1 process boundary

`agent.cmd` is inspected read-only and resolved to `node.exe` + `index.js`. Spawn uses `shell=false` and an argv array. The executor does **not** construct `cmd.exe /d /s /c <command line>` from prompt or workspace data. Unknown `.cmd`/`.bat` files are rejected before spawn.

`--trust` is never injected silently. `--force`, `--yolo`, and `--approve-mcps` are never emitted.

Child environment is an explicit allowlist. Parent secrets (including synthetic `JETRO_TEST_SECRET`) are not copied. The child environment is never returned in RunnerResult/Evidence.

## Exit status

Process exit is captured from the child process `close` code. Classification keeps three independent axes:

- PROCESS_EXIT_STATUS
- CLI_PROTOCOL_STATUS
- AGENT_RESULT (text payload, not authority)

`SUCCEEDED` requires `type === "result"`, `subtype === "success"`, and `is_error === false`. Missing or wrong-typed fields fail closed. `is_error=false` or JSON `subtype=success` is never sufficient for lifecycle success.

Spawn failures are converted to `PROCESS_ERROR` inside `run()`. No throw out of the Runner contract. No retry.

## Timeout

External timeout (default 180000 ms). On timeout: terminate the spawned process, `timedOut=true`, preserve captured stdout/stderr, **no retry**.

Windows descendant / process-tree termination is **not** guaranteed (`WINDOWS_DESCENDANT_TERMINATION_GUARANTEE=NO`).

## Tests

- `node --test src/runtime/controlledCursorRunner.test.js`
- `node --test src/runtime/nodeChildProcessExecutor.adversarial.test.js`
