import { hrefFor } from "../router.ts";
import { useDataSource } from "../DataSourceContext.tsx";
import { useAsync } from "../useAsync.ts";
import { taskStateLabel } from "../../domain/projections.js";

export function TasksPage() {
  const source = useDataSource();
  const { data, error, loading } = useAsync(() => source.listTasks(), [source]);

  if (loading) {
    return <p>Loading tasks…</p>;
  }
  if (error || !data) {
    return <p role="alert">{error ?? "Unable to load tasks"}</p>;
  }

  return (
    <section>
      <h1>Tasks</h1>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Objective</th>
            <th>State</th>
            <th>Approval</th>
            <th>PR</th>
          </tr>
        </thead>
        <tbody>
          {data.map((task) => (
            <tr key={task.id}>
              <td>
                <a href={hrefFor(`/tasks/${encodeURIComponent(task.id)}`)}>
                  {task.id}
                </a>
              </td>
              <td>{task.objective}</td>
              <td>{taskStateLabel(task.state)}</td>
              <td>{task.approvalStatus}</td>
              <td>{task.prNumber ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
