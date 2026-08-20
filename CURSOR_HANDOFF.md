# Cursor Handoff

Created by: Claude Code
Validated from: ORCHESTRATION_IMPLEMENTATION_TASK.md
Test: GATE-8C
Status: READY_FOR_CURSOR

## Objective

Implement a JavaScript utility named `greet`, as specified in `ORCHESTRATION_IMPLEMENTATION_TASK.md` on this branch.

## Required implementation

- Create `src/orchestration-greeting.js`.
- Export exactly one function named `greet(name)`.
- The function must return exactly `Hello, ${name}!`.

## Required tests

- Create `src/orchestration-greeting.test.js`.
- Cover `greet("World")` → `"Hello, World!"`.
- Cover `greet("")` → `"Hello, !"`.
- Use Node's built-in test runner (`node --test`).
- Do not add dependencies or modify existing files outside these two new `src/` files.

## Constraints

- Do not modify `main`.
- Publish the implementation on a dedicated Cursor branch; do not merge to `main`.
- No VPS, production, JETRO/IBE, databases, or deployments may be accessed.

## Validation note

This contract was reviewed by Claude Code and found internally consistent — no contradictions between the stated task, acceptance criteria, and constraints. Claude Code did not implement the task; implementation is Cursor's responsibility per the original contract.
