# Orchestration Implementation Task

Created by: ChatGPT
Test: GATE-8C
Status: READY_FOR_CLAUDE

## Objective
Validate the full handoff chain ChatGPT → GitHub → Claude → GitHub → Cursor using a minimal isolated implementation task.

## Task
Implement a JavaScript utility named `greet`.

## Required implementation
- Create `src/orchestration-greeting.js`.
- Export exactly one function named `greet(name)`.
- Return exactly `Hello, ${name}!`.

## Required tests
- Create `src/orchestration-greeting.test.js`.
- Cover `greet("World")` → `Hello, World!`.
- Cover `greet("")` → `Hello, !`.
- Use Node's built-in test runner (`node --test`).
- Do not add dependencies or modify existing files outside the two new `src/` files.

## Claude responsibility
1. Read and validate this contract.
2. Do not implement the task.
3. Create `CURSOR_HANDOFF.md` on this same branch containing the validated implementation instructions for Cursor.
4. Commit and push only that handoff file.
5. Do not modify `main`.

## Cursor responsibility
After receiving the handoff, implement the task exactly as specified, run the tests, and publish the implementation on a dedicated Cursor branch. Do not merge to `main`.

## Safety
No VPS, production, JETRO/IBE, databases, or deployments may be accessed.

## Required Claude response
ORCHESTRATION_CONTRACT_REVIEW = PASS

Branch: chatgpt/orchestration-test
Handoff: CURSOR_HANDOFF.md
Status: READY_FOR_CURSOR

STOP after publishing the handoff.
