import type { ReactNode } from "react";
import { hrefFor } from "../router.ts";

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
          approve, merge, or replace human authority.
        </p>
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
