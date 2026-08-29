# Pre-Execution Gate v1.0 — implementation evidence

## Scope

Laboratory repository only: `tane14/jetro-automation-spike`.

v1.0 adds a local Node `PreExecutionGateRuntime` that records an explicit human **pre-execution acknowledgement** for one LEASED execution and transitions the Task `READY → AUTHORIZED`. It does not start Cursor, Claude, RUNNING, GitHub write, or merge.

## Flags

- PRE_EXECUTION_ACK_IS_OPERATIONAL_AUTHORIZATION
- NOT_GITHUB_APPROVAL
- NOT_COMPLETION_APPROVAL
- NOT_MERGE_AUTHORIZATION
- NO_AGENT_STARTED
- FUTURE_RUNNER_REQUIRES_ACK_AND_AUTHORIZED_TASK

## SHAs

- BASE_SHA (`origin/main` at branch creation, includes PR #25): `3e62b4f78bd0996bf6651bcecb63817e2e3a6877`
- HEAD_SHA: recorded in the commit on `cursor/pre-execution-gate-v10`

## Architecture

```
TaskDispatchRuntime → Execution LEASED, Task READY
  → PreExecutionGateRuntime.authorizeExecution({ execution_id, acknowledged_by })
      → verify stored Task binding
      → READY → AUTHORIZED (lifecycle.js unchanged)
      → persist Task AUTHORIZED
      → persist lifecycle transition
      → persist pre-execution-acks/{execution_id}.json LAST
  → Execution remains LEASED
  → evaluateStartAuthorization(execution_id)
      → allowed only if ack + AUTHORIZED + LEASED + binding + lease + correlation
```

## Identity policy

`acknowledged_by` must be `{ kind: "human", identity }` (CLI string is wrapped). ASCII-only identity regex. Denied identities include executor, reviewer, cursor, claude, gpt, chatgpt, system, automation, ci, runner, pipeline, service, github-actions, and other agent/orchestrator names. This is a **local denylist**, not GitHub identity proof. N1 closed: `reviewer` and common automation labels are denied case-insensitively.

## Persistence order

Task AUTHORIZED is written before the ack. A visible ack never exists while the Task remains READY. Q2 multi-file transaction is not solved. Future runner must require **both** a valid ack and Task AUTHORIZED.

Duplicate ack: FAIL (no overwrite).

## Future runner contract

`CursorExecutorTransport.startAgent(execution_id)` MUST call `evaluateStartAuthorization`. Spawn only when `allowed === true`, which requires:

1. Task == AUTHORIZED
2. PreExecutionAck valid for this execution_id
3. Task binding valid
4. execution == LEASED
5. lease not expired
6. correlations valid

`allowed === true` is not GitHub APPROVED. `sufficient_for_authority` remains false.

## Tests

- `node --test src/runtime/gate.test.js`
- `node --test src/runtime/exchange.test.js`
- `node --test src/runtime/dispatch.test.js`
- `node --test src/runtime/runtime.test.js`
- `node --test src/contracts/contracts-v05.test.js`
- `npm test` in `src/web-mvp/`
- Full `src/**/*.test.js` suite
