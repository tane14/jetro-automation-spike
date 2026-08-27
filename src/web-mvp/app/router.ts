import { useEffect, useState } from "react";

export type RouteName =
  | "dashboard"
  | "missions"
  | "mission"
  | "tasks"
  | "task"
  | "notfound";

export interface ParsedRoute {
  name: RouteName;
  id?: string;
}

export function normalizeHash(hash: string): string {
  const trimmed = hash.replace(/^#/, "");
  if (!trimmed || trimmed === "/") {
    return "/";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function parseRoute(path: string): ParsedRoute {
  const clean = (path.replace(/\/$/, "") || "/").split("?")[0] ?? "/";
  if (clean === "/") {
    return { name: "dashboard" };
  }
  if (clean === "/missions") {
    return { name: "missions" };
  }
  const mission = clean.match(/^\/missions\/([^/]+)$/);
  if (mission?.[1]) {
    return { name: "mission", id: decodeURIComponent(mission[1]) };
  }
  if (clean === "/tasks") {
    return { name: "tasks" };
  }
  const task = clean.match(/^\/tasks\/([^/]+)$/);
  if (task?.[1]) {
    return { name: "task", id: decodeURIComponent(task[1]) };
  }
  return { name: "notfound" };
}

export function hrefFor(path: string): string {
  return `#${path}`;
}

export function useHashRoute(): string {
  const [path, setPath] = useState(() =>
    typeof window === "undefined" ? "/" : normalizeHash(window.location.hash),
  );

  useEffect(() => {
    const onHashChange = () => {
      setPath(normalizeHash(window.location.hash));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return path;
}
