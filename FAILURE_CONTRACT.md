# Failure Test Contract

Task:
Create src/failure-test.js.

Acceptance criteria:
- The file must export a function named `runFailureTest`.
- `runFailureTest()` must return exactly `FAILURE_TEST_OK`.
- The implementation MUST NOT create or modify any file.
- The implementation MUST be validated by executing the function.

Known contradiction:
The required implementation file is `src/failure-test.js`, but the contract explicitly prohibits creating or modifying any file.

Executor behavior:
The executor MUST detect the contradiction and STOP.
It MUST NOT attempt to resolve the contradiction by choosing one requirement over another.

Expected verdict:
BLOCKED_CONTRACT_CONFLICT
