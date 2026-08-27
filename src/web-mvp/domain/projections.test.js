import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { projectTaskDetail, taskStateLabel } from "./projections.js";

const agents = [{ id: "agent-cursor", name: "Cursor agent", kind: "cursor" }];

function sampleTask(overrides = {}) {
  return {
    id: "TASK-20260820-001",
    missionId: "MISSION-1",
    objective: "Harden approval provenance",
    state: "approved",
    assignedAgentId: "agent-cursor",
    prNumber: 17,
    prUrl: "https://github.com/tane14/jetro-automation-spike/pull/17",
    headSha: "a4fd96ec4206b65f160b34ff77079cb34c065e94",
    approvalStatus: "approved",
    ...overrides,
  };
}

describe("task projections", () => {
  it("projects assigned agent, PR, head SHA, and approval status", () => {
    const projection = projectTaskDetail({
      task: sampleTask(),
      agents,
      reviews: [],
      approvals: [],
      evidence: [],
      policyDecisions: [],
      executions: [],
      events: [],
    });

    assert.equal(projection.assignedAgent?.name, "Cursor agent");
    assert.equal(projection.task.prNumber, 17);
    assert.equal(
      projection.task.headSha,
      "a4fd96ec4206b65f160b34ff77079cb34c065e94",
    );
    assert.equal(projection.task.approvalStatus, "approved");
    assert.equal(projection.task.objective, "Harden approval provenance");
  });

  it("builds a chronological timeline from mixed sources", () => {
    const projection = projectTaskDetail({
      task: sampleTask(),
      agents,
      reviews: [
        {
          id: "review-claude-001",
          taskId: "TASK-20260820-001",
          kind: "claude",
          author: "claude",
          state: "COMMENTED",
          submittedAt: "2026-08-20T15:00:00.000Z",
        },
      ],
      approvals: [],
      evidence: [
        {
          id: "evidence-md-001",
          taskId: "TASK-20260820-001",
          recordedAt: "2026-08-20T14:00:00.000Z",
          path: "control-plane/evidence/example.md",
          summary: "Markdown notes",
        },
      ],
      policyDecisions: [],
      executions: [],
      events: [
        {
          id: "event-late",
          taskId: "TASK-20260820-001",
          occurredAt: "2026-08-20T16:00:00.000Z",
          type: "merge",
          summary: "merged",
        },
      ],
    });

    assert.deepEqual(
      projection.timeline.map((entry) => entry.id),
      ["evidence:evidence-md-001", "review:review-claude-001", "event-late"],
    );
    assert.equal(projection.timeline[0].authorityKind, "markdown_evidence");
    assert.equal(projection.timeline[1].authorityKind, "claude_review");
  });
});

describe("task state display", () => {
  it("maps known states to display labels", () => {
    assert.equal(taskStateLabel("in_progress"), "In progress");
    assert.equal(taskStateLabel("awaiting_approval"), "Awaiting approval");
    assert.equal(taskStateLabel("approved"), "Approved");
    assert.equal(taskStateLabel("done"), "Done");
  });

  it("falls back to the raw state for unknown values", () => {
    assert.equal(taskStateLabel("custom_hold"), "custom_hold");
  });

  it("projects the displayable task state from the record", () => {
    const projection = projectTaskDetail({
      task: sampleTask({ state: "in_review" }),
      agents,
      reviews: [],
      approvals: [],
      evidence: [],
      policyDecisions: [],
      executions: [],
      events: [],
    });

    assert.equal(projection.task.state, "in_review");
    assert.equal(taskStateLabel(projection.task.state), "In review");
  });
});
