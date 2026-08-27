# Web Control Plane MVP foundation v0.5

## Scope

Laboratory repository only: `tane14/jetro-automation-spike`.

This file is documentation and validation evidence for the nested read-only web app under `src/web-mvp/`. It is not an approval, not provenance, and not an authority source.

No JETRO/IBE, VPS, production, database, OAuth, GitHub write, merge, agent dispatch, deploy, or ruleset changes are covered or implied.

## What landed

- Nested Vite + React + TypeScript app at `src/web-mvp/` so `task-boundary` continues to allow only `.github/*|control-plane/*|src/*|README.md|.gitignore`.
- Domain entities: Mission, Task, Agent, Execution, Review, Approval, Evidence, PolicyDecision, Event.
- Read-only `ControlPlaneDataSource` with `MockControlPlaneDataSource`. `GitHubControlPlaneDataSource` is a stub type only.
- Screens: Dashboard, Missions, Mission detail, Tasks, Task detail.
- Authority labeling: GitHub human approval = authoritative; Claude review = advisory; Markdown evidence = non-authoritative.

## How to verify locally

```powershell
cd src/web-mvp
npm install
npm test
```

CI `validation-evidence` also runs `src/**/*.test.js` via `node --test` (domain/authority/timeline/projection/state tests).

## Status

`WEB_MVP_FOUNDATION_V05 = IMPLEMENTED_READ_ONLY_LOCAL`

This evidence artifact does not grant merge or approval authority.
