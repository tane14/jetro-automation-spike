import { AuthorityBadge } from "../components/AuthorityBadge.tsx";
import { hrefFor } from "../router.ts";
import { useDataSource } from "../DataSourceContext.tsx";
import { useAsync } from "../useAsync.ts";
import { taskStateLabel } from "../../domain/projections.js";
import type { AuthorityKind } from "../../domain/types.ts";

function rankKind(rank: string): AuthorityKind {
  if (rank === "advisory") return "claude_review";
  if (rank === "reference-only") return "evidence_reference";
  if (rank === "live-verification-required") return "human_approval_gate";
  return "contract_record";
}

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

  const view = data.contractView;
  const task = data.task;
  const assignedAgent = data.assignedAgent;
  const invalid = view && view.chainConsistency !== "valid";

  return (
    <section data-testid="task-detail" data-chain-consistency={view?.chainConsistency ?? "unknown"}>
      <p className="crumb">
        <a href={hrefFor("/tasks")}>Tasks</a>
        {" · "}
        <a href={hrefFor(`/missions/${encodeURIComponent(task.missionId)}`)}>
          {task.missionId}
        </a>
      </p>
      <h1>{view?.taskId || task.id}</h1>

      {invalid ? (
        <p className="fail-closed" role="alert" data-testid="fail-closed">
          INVALID / INCONSISTENT CONTRACT CHAIN. Validation errors are not a
          successful result and are not human approval.
        </p>
      ) : null}

      {view ? (
        <p
          className="authority-callout"
          data-testid="authority-flags"
          data-sufficient-for-authority={String(view.sufficientForAuthority)}
          data-requires-live-github={String(view.requiresLiveGithubApproval)}
        >
          sufficient_for_authority={String(view.sufficientForAuthority)}.
          requires_live_github_approval={String(view.requiresLiveGithubApproval)}.
          This view does not authorize execution or approval.
        </p>
      ) : null}

      <dl className="meta">
        <div>
          <dt>Task ID</dt>
          <dd data-testid="task-id">{view?.taskId || task.id}</dd>
        </div>
        <div>
          <dt>Mission</dt>
          <dd data-testid="task-mission">{view?.missionId || task.missionId}</dd>
        </div>
        <div>
          <dt>Lifecycle state</dt>
          <dd data-testid="task-state">{taskStateLabel(view?.lifecycleState || task.state)}</dd>
        </div>
        <div>
          <dt>Assigned agent</dt>
          <dd data-testid="assigned-agent">
            {assignedAgent
              ? `${assignedAgent.name} (${assignedAgent.kind})`
              : "Unassigned"}
          </dd>
        </div>
        <div>
          <dt>Risk tier</dt>
          <dd data-testid="risk-tier">{view?.riskTier ?? "—"}</dd>
        </div>
        <div>
          <dt>Contract / version</dt>
          <dd data-testid="contract-version">
            {view ? `${view.contractId} / ${view.schemaVersion}` : "—"}
          </dd>
        </div>
        <div>
          <dt>Execution status</dt>
          <dd data-testid="execution-status">{view?.executionStatus ?? "—"}</dd>
        </div>
        <div>
          <dt>Review status</dt>
          <dd data-testid="review-status">{view?.reviewStatus ?? "—"}</dd>
        </div>
        <div>
          <dt>Human approval status</dt>
          <dd data-testid="approval-status">
            {view?.humanApprovalStatus ?? task.approvalStatus}
          </dd>
        </div>
        <div>
          <dt>Head SHA</dt>
          <dd data-testid="head-sha" className="mono">
            {view?.headSha ?? task.headSha ?? "—"}
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
      </dl>

      <h2>Objective</h2>
      <p data-testid="task-objective">{view?.objective || task.objective}</p>

      {view ? (
        <>
          <h2>Handoff chain</h2>
          <ol className="handoff-chain" data-testid="handoff-chain">
            {view.handoffChain.map((step) => (
              <li key={step.key} data-chain-step={step.key} data-chain-rank={step.rank}>
                <strong>{step.title}</strong>
                <AuthorityBadge kind={rankKind(step.rank)} testId={`chain-authority-${step.key}`} />
                <span>{step.summary}</span>
              </li>
            ))}
          </ol>
        </>
      ) : null}

      {view?.humanApprovalStatus === "live_github_verification_required" ? (
        <section className="gate-panel" data-testid="approval-gate-panel">
          <h2>Human approval gate</h2>
          <AuthorityBadge kind="human_approval_gate" testId="gate-authority" />
          <p data-testid="live-github-banner">
            LIVE GITHUB VERIFICATION REQUIRED. This JSON record is derived and
            is not live GitHub approval. approval-provenance remains the human
            authority check.
          </p>
        </section>
      ) : null}

      <h2>Evidence references</h2>
      {data.evidence.length === 0 ? (
        <p className="muted">No evidence recorded.</p>
      ) : (
        <ul className="card-list">
          {data.evidence.map((item) => (
            <li key={item.id} className="card" data-testid={`evidence-${item.id}`}>
              <div className="card-head">
                <strong>{item.path}</strong>
                <AuthorityBadge kind="evidence_reference" testId={`evidence-authority-${item.id}`} />
              </div>
              <p>{item.summary}</p>
            </li>
          ))}
        </ul>
      )}

      {invalid && view ? (
        <section data-testid="consistency-errors">
          <h2>Validation errors</h2>
          <ul>
            {view.consistencyErrors.map((err, index) => (
              <li key={`${index}:${err}`}>{err}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <h2>Timeline</h2>
      <ol className="timeline" data-testid="task-timeline">
        {data.timeline.map((entry) => (
          <li key={entry.id} data-timeline-id={entry.id}>
            <time dateTime={entry.occurredAt}>{entry.occurredAt}</time>
            <span className="timeline-type">{entry.type}</span>
            <span>{entry.summary}</span>
            {entry.authorityKind ? <AuthorityBadge kind={entry.authorityKind} /> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
