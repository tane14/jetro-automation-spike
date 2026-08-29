# jetro-automation-spike

Web Control Plane MVP (local, read-only, consumes Contracts v0.5): see `src/web-mvp/README.md`.

Task/Handoff contracts v0.5: see `control-plane/contracts/v0.5/README.md`.

Mission/Task runtime v0.7 (local JSON store, Node only, not authority): see `src/runtime/` and `control-plane/evidence/MISSION_TASK_RUNTIME_V07.md`.

Task Dispatch runtime v0.8 (assignment + LEASED execution + READY + JSON package; not Cursor automation, not approval): see `control-plane/evidence/TASK_DISPATCH_RUNTIME_V08.md`.

Executor Exchange runtime v0.9 (local outbox/inbox + `execution_handoff` ingest; human-triggered CLI; not Cursor/Claude automation, not approval): see `control-plane/evidence/EXECUTOR_EXCHANGE_V09.md`.

Pre-Execution Gate v1.0 (human ack → Task AUTHORIZED; operational start authorization only; not GitHub/PR/merge approval; no agent spawn): see `control-plane/evidence/PRE_EXECUTION_GATE_V10.md`.
