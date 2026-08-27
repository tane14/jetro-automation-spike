import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TASK_STATE_LABELS, taskStateLabel } from "./projections.js";

describe("task state catalog", () => {
  it("covers the laboratory lifecycle states", () => {
    const expected = [
      "draft",
      "ready",
      "in_progress",
      "in_review",
      "awaiting_approval",
      "approved",
      "blocked",
      "done",
    ];
    assert.deepEqual(Object.keys(TASK_STATE_LABELS), expected);
  });

  it("never displays an empty label for a known state", () => {
    for (const state of Object.keys(TASK_STATE_LABELS)) {
      const label = taskStateLabel(state);
      assert.ok(label.length > 0);
      assert.notEqual(label, "");
    }
  });
});
