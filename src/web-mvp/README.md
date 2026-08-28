# Web Control Plane MVP v0.6

Read-only laboratory UI for JETRO control-plane facts. GitHub remains the system of record. This app does not approve, merge, dispatch agents, or mutate repository policy.

v0.6 consumes canonical Task/Handoff **Contracts v0.5** through an adapter:

```
Web MVP
  → ControlPlaneDataSource
  → Contract Adapter
  → src/contracts + control-plane/contracts/v0.5
  → Authority Boundary
```

React screens do not import JSON Schema. `validateDocument()` / `valid: true` is never authorization. Human approval remains a live GitHub PR review verified by approval-provenance v0.4.

## Run locally

From this directory:

```powershell
npm install
npm test
npm run dev
```

Open the Vite URL (typically `http://localhost:5173`).

Routes:

- `#/` dashboard
- `#/missions` missions list
- `#/missions/:id` mission detail
- `#/tasks` tasks list
- `#/tasks/:id` task detail

There is no deploy target.

## Authority labeling

- GitHub human approval (live PR review + approval-provenance) = AUTHORITATIVE
- Claude review = ADVISORY
- Markdown = NON-AUTHORITATIVE
- Evidence = REFERENCE ONLY
- Human approval gate JSON = LIVE VERIFICATION REQUIRED
