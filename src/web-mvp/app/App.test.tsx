import { cleanup, render, screen, within } from "@testing-library/react";
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
    expect(await screen.findByText("TASK-20260828-001")).toBeInTheDocument();
  });

  it("renders missions and tasks list screens", async () => {
    renderApp("#/missions");
    expect(await screen.findByRole("heading", { name: "Missions" })).toBeInTheDocument();
    expect(await screen.findByText("MISSION-20260828-001")).toBeInTheDocument();

    cleanup();
    renderApp("#/tasks");
    expect(await screen.findByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getAllByText("Review ready").length).toBeGreaterThan(0);
  });
});

describe("valid contract renders correctly", () => {
  it("shows contract fields from the v0.5 task contract", async () => {
    renderApp("#/tasks/TASK-20260828-001");
    await screen.findByTestId("task-detail");

    expect(screen.getByTestId("task-id")).toHaveTextContent("TASK-20260828-001");
    expect(screen.getByTestId("task-mission")).toHaveTextContent("MISSION-20260828-001");
    expect(screen.getByTestId("task-objective")).toHaveTextContent(
      "Valid Contracts v0.5 handoff chain",
    );
    expect(screen.getByTestId("assigned-agent")).toHaveTextContent("cursor");
    expect(screen.getByTestId("task-state")).toHaveTextContent("Review ready");
    expect(screen.getByTestId("risk-tier")).toHaveTextContent("—");
    expect(screen.getByTestId("contract-version")).toHaveTextContent("CONTRACT-20260828-001 / 0.5");
    expect(screen.getByTestId("execution-status")).toHaveTextContent("RESULT_SUBMITTED");
    expect(screen.getByTestId("handoff-chain")).toBeInTheDocument();
    expect(screen.getByTestId("task-detail")).toHaveAttribute(
      "data-chain-consistency",
      "valid",
    );
  });
});

describe("invalid contract fails closed", () => {
  it("shows INVALID and never PASS/approved", async () => {
    renderApp("#/tasks/TASK-20260828-006");
    await screen.findByTestId("fail-closed");
    expect(screen.getByTestId("fail-closed")).toHaveTextContent("INVALID");
    expect(screen.getByTestId("approval-status")).not.toHaveTextContent("approved");
    expect(screen.getByTestId("task-detail")).toHaveAttribute(
      "data-chain-consistency",
      "invalid",
    );
  });
});

describe("authority labeling in the UI", () => {
  it("does not present Claude review as human approval", async () => {
    renderApp("#/tasks/TASK-20260828-002");
    await screen.findByTestId("task-detail");
    const claude = screen.getByTestId("chain-authority-review_handoff");
    expect(claude).toHaveTextContent("ADVISORY");
    expect(claude).not.toHaveTextContent("GitHub human approval");
    expect(claude).toHaveAttribute("data-authority-rank", "advisory");
    expect(claude.getAttribute("data-authority-rank")).not.toBe("authoritative");
  });

  it("does not present Markdown as authority and keeps evidence reference-only", async () => {
    renderApp("#/tasks/TASK-20260828-001");
    await screen.findByTestId("task-detail");
    const evidence = screen.getByTestId("chain-authority-evidence");
    expect(evidence).toHaveTextContent("REFERENCE ONLY");
    expect(evidence).not.toHaveTextContent("GitHub human approval");
    expect(evidence).toHaveAttribute("data-authority-rank", "reference-only");
    const markdownLegend = screen.getByTestId("authority-legend");
    expect(within(markdownLegend).getByText("NON-AUTHORITATIVE")).toBeInTheDocument();
  });

  it("requires live GitHub verification on the human approval gate", async () => {
    renderApp("#/tasks/TASK-20260828-003");
    await screen.findByTestId("approval-gate-panel");
    expect(screen.getByTestId("live-github-banner")).toHaveTextContent(
      "LIVE GITHUB VERIFICATION REQUIRED",
    );
    const gate = screen.getByTestId("gate-authority");
    expect(gate).toHaveTextContent("LIVE VERIFICATION REQUIRED");
    expect(gate).toHaveAttribute("data-authority-rank", "live-verification-required");
    expect(gate.getAttribute("data-authority-rank")).not.toBe("authoritative");
    expect(screen.getByTestId("authority-flags")).toHaveAttribute(
      "data-sufficient-for-authority",
      "false",
    );
    expect(screen.getByTestId("authority-flags")).toHaveAttribute(
      "data-requires-live-github",
      "true",
    );
  });

  it("turns head SHA mismatch into an invalid state", async () => {
    renderApp("#/tasks/TASK-20260828-004");
    await screen.findByTestId("fail-closed");
    expect(screen.getByTestId("task-detail")).toHaveAttribute(
      "data-chain-consistency",
      "invalid",
    );
  });
});
