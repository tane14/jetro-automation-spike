import { hrefFor } from "../router.ts";
import { useDataSource } from "../DataSourceContext.tsx";
import { useAsync } from "../useAsync.ts";

export function MissionDetailPage({ missionId }: { missionId: string }) {
  const source = useDataSource();
  const { data, error, loading } = useAsync(async () => {
    const mission = await source.getMission(missionId);
    if (!mission) {
      return null;
    }
    const allTasks = await source.listTasks();
    return {
      mission,
      tasks: allTasks.filter((task) => task.missionId === mission.id),
    };
  }, [source, missionId]);

  if (loading) {
    return <p>Loading mission…</p>;
  }
  if (error) {
    return <p role="alert">{error}</p>;
  }
  if (!data) {
    return <p role="alert">Mission {missionId} was not found.</p>;
  }

  return (
    <section>
      <p className="crumb">
        <a href={hrefFor("/missions")}>Missions</a>
      </p>
      <h1>{data.mission.title}</h1>
      <dl className="meta">
        <div>
          <dt>Mission ID</dt>
          <dd>{data.mission.id}</dd>
        </div>
        <div>
          <dt>State</dt>
          <dd>{data.mission.state}</dd>
        </div>
      </dl>
      <h2>Objective</h2>
      <p>{data.mission.objective}</p>
      <h2>Tasks</h2>
      <ul className="plain-list">
        {data.tasks.map((task) => (
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
