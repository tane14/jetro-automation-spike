import { AuthorityBadge } from "../components/AuthorityBadge.tsx";
import { hrefFor } from "../router.ts";
import { useDataSource } from "../DataSourceContext.tsx";
import { useAsync } from "../useAsync.ts";
import {
  authorityForApproval,
  authorityForEvidence,
  authorityForReview,
} from "../../domain/authority.js";
import { taskStateLabel } from "../../domain/projections.js";

export function TaskDetailPage({ taskId }: { taskId: string }) {
  const source = useDataSource();
  const { data, error, loading } = useAsync(
    () => source.getTaskDetail(taskId),
    [source, taskId],
  );

  if (loading) {
    return <p>Loading task…</p>;
  }
  if (error) {
    return <p role="alert">{error}</p>;
  }
  if (!data) {
    return <p role="alert">Task {taskId} was not found.</p>;
  }

  const { task, assignedAgent } = data;

  return (
    <section data-testid="task-detail">
      <p className="crumb">
        <a href={hrefFor("/tasks")}>Tasks</a>
        {" · "}
        <a href={hrefFor(`/missions/${encodeURIComponent(task.missionId)}`)}>
          {task.missionId}
        </a>
      </p>
      <h1>{task.id}</h1>
      <dl className="meta">
        <div>
          <dt>Task ID</dt>
          <dd data-testid="task-id">{task.id}</dd>
        </div>
        <div>
          <dt>State</dt>
          <dd data-testid="task-state">{taskStateLabel(task.state)}</dd>
        </div>
        <div>
          <dt>Assigned agent</dt>
          <dd data-testid="assigned-agent">
            {assignedAgent ? `${assignedAgent.name} (${assignedAgent.kind})` : "Unassigned"}
          </dd>
        </div>
        <div>
          <dt>PR</dt>
          <dd data-testid="task-pr">
            {task.prUrl && task.prNumber ? (
              <a href={task.prUrl} target="_blank" rel="noreferrer">
                #{task.prNumber}
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt>Head SHA</dt>
          <dd data-testid="head-sha" className="mono">
            {task.headSha ?? "—"}
          </dd>
        </div>
        <div>
          <dt>Approval status</dt>
          <dd data-testid="approval-status">{task.approvalStatus}</dd>
        </div>
      </dl>

      <h2>Objective</h2>
      <p data-testid="task-objective">{task.objective}</p>

      <h2>Policy decisions / checks</h2>
      {data.policyDecisions.length === 0 ? (
        <p className="muted">No policy decisions recorded.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Check</th>
              <th>Conclusion</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {data.policyDecisions.map((decision) => (
              <tr key={decision.id}>
                <td>{decision.checkName}</td>
                <td>{decision.conclusion}</td>
                <td>{decision.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Reviews</h2>
      {data.reviews.length === 0 ? (
        <p className="muted">No reviews recorded.</p>
      ) : (
        <ul className="card-list">
          {data.reviews.map((review) => {
            const kind = authorityForReview(review);
            return (
              <li
                key={review.id}
                className="card"
                data-testid={`review-${review.id}`}
              >
                <div className="card-head">
                  <strong>{review.author}</strong>
                  <span>{review.state}</span>
                  <AuthorityBadge kind={kind} testId={`review-authority-${review.id}`} />
                </div>
                <p>{review.body}</p>
              </li>
            );
          })}
        </ul>
      )}

      <h2>Approvals</h2>
      {data.approvals.length === 0 ? (
        <p className="muted">No approval records projected.</p>
      ) : (
        <ul className="card-list">
          {data.approvals.map((approval) => (
            <li key={approval.id} className="card" data-testid={`approval-${approval.id}`}>
              <div className="card-head">
                <strong>{approval.reviewerLogin ?? "unknown reviewer"}</strong>
                <AuthorityBadge
                  kind={authorityForApproval(approval)}
                  testId={`approval-authority-${approval.id}`}
                />
              </div>
              <p className="mono">{approval.commitId ?? "no commit"}</p>
              {approval.artifactPath ? (
                <p className="muted">Artifact: {approval.artifactPath}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <h2>Evidence</h2>
      {data.evidence.length === 0 ? (
        <p className="muted">No evidence recorded.</p>
      ) : (
        <ul className="card-list">
          {data.evidence.map((item) => (
            <li key={item.id} className="card" data-testid={`evidence-${item.id}`}>
              <div className="card-head">
                <strong>{item.path}</strong>
                <AuthorityBadge
                  kind={authorityForEvidence(item)}
                  testId={`evidence-authority-${item.id}`}
                />
              </div>
              <p>{item.summary}</p>
            </li>
          ))}
        </ul>
      )}

      <h2>Timeline</h2>
      <ol className="timeline" data-testid="task-timeline">
        {data.timeline.map((entry) => (
          <li key={entry.id} data-timeline-id={entry.id}>
            <time dateTime={entry.occurredAt}>{entry.occurredAt}</time>
            <span className="timeline-type">{entry.type}</span>
            <span>{entry.summary}</span>
            {entry.authorityKind ? (
              <AuthorityBadge kind={entry.authorityKind} />
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
