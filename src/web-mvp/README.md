# Web Control Plane MVP v0.5

Read-only laboratory UI for JETRO control-plane facts. GitHub remains the system of record. This app does not approve, merge, dispatch agents, or mutate repository policy.

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

There is no deploy target in v0.5.

## Authority labeling

- GitHub human approval = authoritative
- Claude review = advisory
- Markdown evidence = non-authoritative
