import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App.tsx";
import { MockControlPlaneDataSource } from "../adapters/MockControlPlaneDataSource.ts";

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

function renderApp(hash = "/") {
  window.location.hash = hash;
  return render(<App dataSource={new MockControlPlaneDataSource()} />);
}

describe("basic render", () => {
  it("renders the dashboard with the read-only authority banner", async () => {
    renderApp("#/");
    expect(screen.getByTestId("authority-banner")).toHaveTextContent(
      "GitHub is the system of record",
    );
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(await screen.findByText("TASK-20260820-001")).toBeInTheDocument();
  });

  it("renders missions and tasks list screens", async () => {
    renderApp("#/missions");
    expect(await screen.findByRole("heading", { name: "Missions" })).toBeInTheDocument();
    expect(
      await screen.findByText("MISSION-CONTROL-PLANE-LAB"),
    ).toBeInTheDocument();

    cleanup();
    renderApp("#/tasks");
    expect(await screen.findByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    expect(await screen.findByText("In progress")).toBeInTheDocument();
  });
});

describe("task detail display", () => {
  it("shows required task fields and state label", async () => {
    renderApp("#/tasks/TASK-20260820-001");
    await screen.findByTestId("task-detail");

    expect(screen.getByTestId("task-id")).toHaveTextContent("TASK-20260820-001");
    expect(screen.getByTestId("task-objective")).toHaveTextContent(
      "Harden approval provenance",
    );
    expect(screen.getByTestId("task-state")).toHaveTextContent("Approved");
    expect(screen.getByTestId("assigned-agent")).toHaveTextContent("Cursor agent");
    expect(screen.getByTestId("task-pr")).toHaveTextContent("#17");
    expect(screen.getByTestId("head-sha")).toHaveTextContent(
      "a4fd96ec4206b65f160b34ff77079cb34c065e94",
    );
    expect(screen.getByTestId("approval-status")).toHaveTextContent("approved");
    expect(screen.getByText("approval-provenance")).toBeInTheDocument();
  });

  it("orders the timeline chronologically", async () => {
    renderApp("#/tasks/TASK-20260820-001");
    const timeline = await screen.findByTestId("task-timeline");
    await waitFor(() => {
      const items = within(timeline)
        .getAllByRole("listitem")
        .map((item) => item.getAttribute("data-timeline-id"));
      expect(items[0]).toBe("event-001");
    });
    const items = within(timeline)
      .getAllByRole("listitem")
      .map((item) => item.getAttribute("data-timeline-id"));
    const times = within(timeline)
      .getAllByRole("listitem")
      .map((item) => item.querySelector("time")?.getAttribute("datetime") ?? "");
    const sorted = [...times].sort((a, b) => a.localeCompare(b));
    expect(times).toEqual(sorted);
    expect(items.length).toBeGreaterThan(3);
  });
});

describe("authority labeling in the UI", () => {
  it("does not present Claude review or Markdown evidence as GitHub human approval", async () => {
    renderApp("#/tasks/TASK-20260820-001");
    await screen.findByTestId("task-detail");

    const github = screen.getByTestId("review-authority-review-github-001");
    expect(github).toHaveTextContent("GitHub human approval");
    expect(github).toHaveTextContent("authoritative");
    expect(github).toHaveAttribute("data-authority-kind", "github_human_approval");

    const claude = screen.getByTestId("review-authority-review-claude-001");
    expect(claude).toHaveTextContent("Claude review");
    expect(claude).toHaveTextContent("advisory");
    expect(claude).not.toHaveTextContent("GitHub human approval");
    expect(claude).toHaveAttribute("data-authority-kind", "claude_review");
    expect(claude).toHaveAttribute("data-authority-rank", "advisory");
    expect(claude.getAttribute("data-authority-rank")).not.toBe("authoritative");

    const markdown = screen.getByTestId("evidence-authority-evidence-md-001");
    expect(markdown).toHaveTextContent("Markdown evidence");
    expect(markdown).toHaveTextContent("non-authoritative");
    expect(markdown).not.toHaveTextContent("GitHub human approval");
    expect(markdown).toHaveAttribute("data-authority-kind", "markdown_evidence");
    expect(markdown).toHaveAttribute("data-authority-rank", "non-authoritative");
    expect(markdown.getAttribute("data-authority-rank")).not.toBe("authoritative");
  });
});
