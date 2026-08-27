import { hrefFor } from "../router.ts";
import { useDataSource } from "../DataSourceContext.tsx";
import { useAsync } from "../useAsync.ts";

export function DashboardPage() {
  const source = useDataSource();
  const { data, error, loading } = useAsync(
    async () => {
      const [missionList, taskList] = await Promise.all([
        source.listMissions(),
        source.listTasks(),
      ]);
      return { missionList, taskList };
    },
    [source],
  );

  if (loading) {
    return <p>Loading dashboard…</p>;
  }
  if (error || !data) {
    return <p role="alert">{error ?? "Unable to load dashboard"}</p>;
  }

  return (
    <section>
      <h1>Dashboard</h1>
      <p className="lede">
        Laboratory projection of missions and tasks. GitHub remains the system
        of record.
      </p>
      <div className="stat-grid">
        <article className="stat-card">
          <p className="stat-label">Missions</p>
          <p className="stat-value">{data.missionList.length}</p>
          <a href={hrefFor("/missions")}>Open missions</a>
        </article>
        <article className="stat-card">
          <p className="stat-label">Tasks</p>
          <p className="stat-value">{data.taskList.length}</p>
          <a href={hrefFor("/tasks")}>Open tasks</a>
        </article>
        <article className="stat-card">
          <p className="stat-label">Authoritative source</p>
          <p className="stat-value">GitHub</p>
          <p>Human PR review only.</p>
        </article>
      </div>
      <h2>Recent tasks</h2>
      <ul className="plain-list">
        {data.taskList.map((task) => (
          <li key={task.id}>
            <a href={hrefFor(`/tasks/${encodeURIComponent(task.id)}`)}>
              {task.id}
            </a>
            <span className="muted"> — {task.state}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
