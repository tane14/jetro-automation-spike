/**
 * Pure view-model projection from a Contracts v0.5 bundle + validation result.
 * React screens consume this object. They must not import schemas.
 *
 * valid: true NEVER becomes human approval or execution authorization.
 */

export const NOT_AUTHORITY = {
  sufficient_for_authority: false,
  requires_live_github_approval: true,
};

export const RANK_DISPLAY = {
  authoritative: "AUTHORITATIVE",
  advisory: "ADVISORY",
  "non-authoritative": "NON-AUTHORITATIVE",
  "reference-only": "REFERENCE ONLY",
  "live-verification-required": "LIVE VERIFICATION REQUIRED",
};

function agentFromAssigned(assigned) {
  if (!assigned) return null;
  const kind =
    assigned.identity === "claude"
      ? "claude"
      : assigned.identity === "cursor"
        ? "cursor"
        : assigned.kind === "human"
          ? "human"
          : "other";
  return {
    id: assigned.identity,
    name: assigned.identity,
    kind,
    role: assigned.role,
  };
}

function chainStep(key, title, rank, summary, present) {
  return {
    key,
    title,
    rank,
    rankDisplay: RANK_DISPLAY[rank],
    summary,
    present: Boolean(present),
  };
}

/**
 * @param {{
 *   entry: { id: string, scenario: string, title: string, objective: string },
 *   bundle: object,
 *   documentResults: Record<string, { valid: boolean, errors: string[] }>,
 *   chain: { valid: boolean, errors: string[], sufficient_for_authority?: boolean, requires_live_github_approval?: boolean },
 *   correlation: { valid: boolean, errors: string[] }
 * }} input
 */
export function projectContractView(input) {
  const { entry, bundle, documentResults, chain, correlation } = input;
  const task = bundle.task || {};
  const docErrors = Object.entries(documentResults || {}).flatMap(([key, result]) =>
    (result.errors || []).map((err) => `${key}: ${err}`),
  );
  const errors = [
    ...docErrors,
    ...(chain.errors || []),
    ...(correlation.errors || []),
  ];
  const documentsValid = Object.values(documentResults || {}).every(
    (result) => result.valid !== false,
  );
  const consistent = documentsValid && chain.valid === true && correlation.valid === true;
  const chainConsistency = consistent ? "valid" : "invalid";

  const assignedAgent = agentFromAssigned(task.assigned_to || bundle.assignment?.assigned_to);
  const gate = bundle.approval_gate;
  const review = bundle.review_handoff;
  const evidence = bundle.evidence;
  const policy = bundle.policy;
  const execution = bundle.execution;
  const handoff = bundle.execution_handoff;

  const sufficientForAuthority = false;
  const requiresLiveGithubApproval = true;

  if (chain.sufficient_for_authority === true || correlation.sufficient_for_authority === true) {
    throw new Error("adapter refused to accept sufficient_for_authority=true");
  }

  const uniqueErrors = [...new Set(errors)];
  const seenEvidence = new Set();
  const evidenceRefs = [];
  for (const ref of task.evidence_refs || []) {
    if (!seenEvidence.has(ref.evidence_id)) {
      seenEvidence.add(ref.evidence_id);
      evidenceRefs.push(ref);
    }
  }
  if (evidence && !seenEvidence.has(evidence.evidence_id)) {
    evidenceRefs.push({
      evidence_id: evidence.evidence_id,
      kind: evidence.kind,
      path: evidence.path,
      authority_rank: "non-authoritative",
      input_role: "reference_only",
    });
  }

  return {
    id: entry.id,
    scenario: entry.scenario,
    taskId: task.task_id || entry.id,
    missionId: task.mission_id || bundle.mission?.mission_id || "",
    missionTitle: bundle.mission?.title || "",
    objective: entry.objective,
    assignedAgent,
    lifecycleState: task.state || "UNKNOWN",
    riskTier: task.risk_tier ?? null,
    contractId: task.contract_id || "",
    schemaVersion: task.schema_version || "",
    contractHash: task.contract_hash || "",
    executionStatus: execution?.state || handoff?.outcome || null,
    prNumber: handoff?.pr_number ?? execution?.pr_number ?? null,
    prUrl: handoff?.pr_number
      ? `https://github.com/tane14/jetro-automation-spike/pull/${handoff.pr_number}`
      : null,
    headSha: handoff?.head_sha || execution?.head_sha || null,
    evidenceRefs,
    reviewStatus: review
      ? `${review.verdict_kind}:${review.verdict || review.state}`
      : null,
    humanApprovalStatus: gate
      ? "live_github_verification_required"
      : "not_recorded",
    chainConsistency,
    consistencyErrors: uniqueErrors,
    sufficientForAuthority,
    requiresLiveGithubApproval,
    approvalStatus: consistent ? "live_verification_required" : "invalid",
    handoffChain: [
      chainStep(
        "task",
        "Task Contract",
        "non-authoritative",
        `${task.task_id || "(missing id)"} ${task.state || ""}`.trim(),
        bundle.task,
      ),
      chainStep(
        "assignment",
        "Agent Assignment",
        "non-authoritative",
        bundle.assignment
          ? `${bundle.assignment.assigned_to.identity} (${bundle.assignment.assigned_to.role})`
          : "missing",
        bundle.assignment,
      ),
      chainStep(
        "execution",
        "Execution",
        "non-authoritative",
        execution ? `${execution.execution_id} ${execution.state}` : "missing",
        execution,
      ),
      chainStep(
        "execution_handoff",
        "Execution Handoff",
        "non-authoritative",
        handoff ? `${handoff.source_role} → ${handoff.target_role} (${handoff.outcome})` : "missing",
        handoff,
      ),
      chainStep(
        "review_handoff",
        "Review Handoff",
        review?.verdict_kind === "claude_advisory" ? "advisory" : "non-authoritative",
        review
          ? `${review.verdict_kind} ${review.verdict || review.state}`
          : "missing",
        review,
      ),
      chainStep(
        "approval_gate",
        "Human Approval Gate",
        "live-verification-required",
        gate
          ? "Derived GitHub record. LIVE GITHUB VERIFICATION REQUIRED."
          : "missing",
        gate,
      ),
      chainStep(
        "evidence",
        "Evidence",
        "reference-only",
        evidence ? `${evidence.path} (${evidence.input_role})` : "missing",
        evidence,
      ),
    ],
    reviewKind: review?.verdict_kind === "claude_advisory" ? "claude_review" : "github_approval_record",
    evidenceKind: "evidence_reference",
    gateKind: "human_approval_gate",
    markdownKind: "markdown_evidence",
    policyCheck: policy
      ? {
          policyVersion: policy.policy_version,
          checkName: policy.check_name,
          conclusion: policy.conclusion,
          inputRole: policy.input_role,
        }
      : null,
    bundle,
    rawChain: chain,
    rawCorrelation: correlation,
    documentResults,
  };
}

export function viewToTask(view) {
  return {
    id: view.taskId,
    missionId: view.missionId,
    objective: view.objective,
    state: view.lifecycleState,
    assignedAgentId: view.assignedAgent?.id ?? null,
    prNumber: view.prNumber,
    prUrl: view.prUrl,
    headSha: view.headSha,
    approvalStatus: view.approvalStatus,
    chainConsistency: view.chainConsistency,
  };
}

export function viewToMission(view, taskIds) {
  const mission = view.bundle.mission;
  return {
    id: mission?.mission_id || view.missionId,
    title: mission?.title || view.missionTitle,
    objective: mission?.description || view.objective,
    state: mission?.state || "",
    taskIds,
  };
}
