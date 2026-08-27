import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sortTimeline } from "./timeline.js";

describe("timeline ordering", () => {
  it("orders events by occurredAt ascending", () => {
    const ordered = sortTimeline([
      { id: "c", occurredAt: "2026-08-20T16:00:00.000Z", type: "c", summary: "c" },
      { id: "a", occurredAt: "2026-08-20T12:00:00.000Z", type: "a", summary: "a" },
      { id: "b", occurredAt: "2026-08-20T14:00:00.000Z", type: "b", summary: "b" },
    ]);

    assert.deepEqual(
      ordered.map((entry) => entry.id),
      ["a", "b", "c"],
    );
  });

  it("uses id as a stable tie-breaker", () => {
    const stamp = "2026-08-20T12:00:00.000Z";
    const ordered = sortTimeline([
      { id: "event-2", occurredAt: stamp, type: "x", summary: "x" },
      { id: "event-1", occurredAt: stamp, type: "x", summary: "x" },
    ]);

    assert.deepEqual(
      ordered.map((entry) => entry.id),
      ["event-1", "event-2"],
    );
  });

  it("does not mutate the input array", () => {
    const input = [
      { id: "b", occurredAt: "2026-08-20T14:00:00.000Z", type: "b", summary: "b" },
      { id: "a", occurredAt: "2026-08-20T12:00:00.000Z", type: "a", summary: "a" },
    ];
    sortTimeline(input);
    assert.equal(input[0].id, "b");
  });
});
