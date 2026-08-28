import { useMemo } from "react";
import type { ControlPlaneDataSource } from "../adapters/ControlPlaneDataSource.ts";
import { MockControlPlaneDataSource } from "../adapters/MockControlPlaneDataSource.ts";
import { DashboardPage } from "./screens/DashboardPage.tsx";
import { MissionDetailPage } from "./screens/MissionDetailPage.tsx";
import { MissionsPage } from "./screens/MissionsPage.tsx";
import { TaskDetailPage } from "./screens/TaskDetailPage.tsx";
import { TasksPage } from "./screens/TasksPage.tsx";
import { parseRoute, useHashRoute } from "./router.ts";
import { Layout } from "./components/Layout.tsx";
import { DataSourceProvider } from "./DataSourceContext.tsx";

export interface AppProps {
  dataSource?: ControlPlaneDataSource;
}

/**
 * Read-only laboratory UI. Optional `dataSource` lets Node tests / future
 * hosts inject StoredControlPlaneDataSource. The browser default is the
 * mock catalog — Vite cannot use the JSON file store (Node fs). This
 * component does not expose create, approve, execute, or merge actions.
 */
export function App({ dataSource }: AppProps) {
  const source = useMemo(
    () => dataSource ?? new MockControlPlaneDataSource(),
    [dataSource],
  );
  const path = useHashRoute();
  const route = parseRoute(path);

  let screen;
  switch (route.name) {
    case "dashboard":
      screen = <DashboardPage />;
      break;
    case "missions":
      screen = <MissionsPage />;
      break;
    case "mission":
      screen = <MissionDetailPage missionId={route.id ?? ""} />;
      break;
    case "tasks":
      screen = <TasksPage />;
      break;
    case "task":
      screen = <TaskDetailPage taskId={route.id ?? ""} />;
      break;
    default:
      screen = (
        <section>
          <h1>Not found</h1>
          <p>No screen for {path}.</p>
        </section>
      );
  }

  return (
    <DataSourceProvider source={source}>
      <Layout>{screen}</Layout>
    </DataSourceProvider>
  );
}
