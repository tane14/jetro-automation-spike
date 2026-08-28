import type { ReactNode } from "react";
import { hrefFor } from "../router.ts";
import { AuthorityBadge } from "./AuthorityBadge.tsx";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <p className="kicker">JETRO laboratory</p>
          <h1 className="product">Web Control Plane</h1>
        </div>
        <p className="authority-banner" data-testid="authority-banner">
          Read-only view. GitHub is the system of record. This UI does not
          approve, merge, or replace human authority. Contract validation
          valid:true is not authorization.
        </p>
        <ul className="authority-legend" data-testid="authority-legend">
          <li>
            <AuthorityBadge kind="github_human_approval" />
            <span>Live GitHub PR review + approval-provenance only</span>
          </li>
          <li>
            <AuthorityBadge kind="claude_review" />
            <span>Never human approval</span>
          </li>
          <li>
            <AuthorityBadge kind="markdown_evidence" />
            <span>Never human approval</span>
          </li>
          <li>
            <AuthorityBadge kind="evidence_reference" />
            <span>Reference only</span>
          </li>
          <li>
            <AuthorityBadge kind="human_approval_gate" />
            <span>Derived record, not live approval</span>
          </li>
        </ul>
      </header>
      <nav className="nav" aria-label="Primary">
        <a href={hrefFor("/")}>Dashboard</a>
        <a href={hrefFor("/missions")}>Missions</a>
        <a href={hrefFor("/tasks")}>Tasks</a>
      </nav>
      <main className="content">{children}</main>
    </div>
  );
}
