# Task Contract

Author: Claude Code
Consumer: Cursor
Test: TASK-CONTRACT-01

## Objective

Implement a small greeting utility function in JavaScript.

## Expected Files

- `src/greeting.js` — implementation of the `greet` function.
- An automated test file covering the behavior described below (location and test framework left to the implementer's discretion, consistent with any existing project conventions).

## Behavior

- Export a function named `greet(name)`.
- The function receives `name` as a string.
- The function returns exactly: `Hello, {name}!` (with `{name}` replaced by the value received).

## Acceptance Criteria

- `greet("World")` returns `"Hello, World!"`.
- `greet("")` returns `"Hello, !"`.
- No additional exports, side effects, or dependencies beyond what is needed for this function.

## Expected Validation

- Automated tests must cover:
  1. A normal, non-empty name.
  2. An empty string name.
- All tests must pass when run with the project's standard test command.

## Constraints

- Implementation and test authoring are left entirely to the implementer's judgment; this contract intentionally specifies no code.
- Do not modify files outside `src/greeting.js` and the new test file.
- Do not introduce new runtime dependencies unless strictly necessary for testing.
