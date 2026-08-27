import { hrefFor } from "../router.ts";
import { useDataSource } from "../DataSourceContext.tsx";
import { useAsync } from "../useAsync.ts";

export function MissionsPage() {
  const source = useDataSource();
  const { data, error, loading } = useAsync(() => source.listMissions(), [source]);

  if (loading) {
    return <p>Loading missions…</p>;
  }
  if (error || !data) {
    return <p role="alert">{error ?? "Unable to load missions"}</p>;
  }

  return (
    <section>
      <h1>Missions</h1>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Title</th>
            <th>State</th>
            <th>Tasks</th>
          </tr>
        </thead>
        <tbody>
          {data.map((mission) => (
            <tr key={mission.id}>
              <td>
                <a href={hrefFor(`/missions/${encodeURIComponent(mission.id)}`)}>
                  {mission.id}
                </a>
              </td>
              <td>{mission.title}</td>
              <td>{mission.state}</td>
              <td>{mission.taskIds.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
