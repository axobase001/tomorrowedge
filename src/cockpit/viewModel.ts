import path from "node:path";
import type { AgentGraphState } from "../core/agentGraph/state.js";
import type { TomorrowEdgeEvent } from "../core/events/eventTypes.js";
import type { CockpitApproval, CockpitApprovalHistoryItem, CockpitConnectionState, CockpitErrorLoopTimelineItem, CockpitMemoryInfluenceCard, CockpitRouteSummary, CockpitSessionSource, CockpitTelemetry, CockpitViewModel, CockpitWorkflowStep } from "./contracts.js";
import { buildCapabilityDashboard } from "./capabilityRegistry.js";
import { resolveCockpitShellCommand } from "./verificationCommand.js";
import { eventSummary, inferWorkflowStage, isMissingPatchDeliverable, sessionTitle, workspaceLabel } from "./sessionSelectors.js";

export type CockpitViewModelOptions = {
  source?: CockpitSessionSource;
  connectionState?: CockpitConnectionState;
  reconnectAttempts?: number;
  stale?: boolean;
  message?: string;
};

export function buildCockpitViewModel(cwd: string, state?: AgentGraphState, options: CockpitViewModelOptions = {}): CockpitViewModel {
  const approvals = buildApprovals(state);
  const currentApproval = approvals.find((approval) => approval.status === "waiting");
  const status = currentApproval ? "waiting_approval" : inferWorkflowStage(state);
  const routes = buildRoutes(state);
  const main = buildMainView(state, currentApproval);
  const sessionMeta = buildSessionMeta(state, options);
  const approvalHistory = buildApprovalHistory(state, currentApproval);
  return {
    version: "1",
    sessionId: state?.sessionId,
    goal: state?.goal ?? "",
    workspace: workspaceLabel(cwd),
    accessMode: state?.access?.mode ?? "local",
    sessionMeta,
    status,
    statusText: statusText(status),
    tasks: [
      {
        id: state?.sessionId ?? "new",
        title: sessionTitle(state),
        status: taskStatus(status),
        updatedAt: latestTimestamp(state?.events),
        reminder: currentApproval ? currentApproval.title : state?.finalSummary?.result ?? "Awaiting task",
        selected: true
      },
      ...recentSyntheticTasks()
    ],
    workflow: buildWorkflow(state, currentApproval),
    agents: (state?.agents ?? []).map((agent) => ({
      role: agent.role,
      provider: agent.provider,
      model: agent.model,
      status: agent.status,
      agentKind: agent.agentKind,
      elapsedMs: agent.elapsedMs
    })),
    routes,
    roleGraph: buildRoleGraphSummary(state),
    taskGraph: buildTaskGraphSummary(state),
    telemetry: buildTelemetry(state, routes, currentApproval),
    approvals,
    approvalHistory,
    capabilities: buildCapabilityDashboard(state),
    memoryInfluence: buildMemoryInfluence(state),
    errorLoopTimeline: buildErrorLoopTimeline(state),
    objectiveContract: buildObjectiveContractSummary(state),
    objectiveTrace: buildObjectiveTraceSummary(state),
    orchestrationPolicy: buildOrchestrationPolicySummary(state),
    currentApproval,
    main,
    trace: (state?.events ?? []).slice(-80).reverse().map((event) => ({
      id: event.id,
      timestamp: event.timestamp,
      type: event.type,
      phase: event.phase,
      role: event.role,
      summary: eventSummary(event)
    })),
    rawEvents: compactRawEvents(state?.events ?? []),
    artifacts: (state?.eventArtifacts ?? []).map((artifact) => ({
      ref: artifact.ref,
      kind: artifact.ref.split(/[\\/]/)[1] ?? "artifact"
    }))
  };
}

function buildObjectiveContractSummary(state?: AgentGraphState): CockpitViewModel["objectiveContract"] {
  const contract = state?.objectiveContract;
  if (!contract) return undefined;
  return {
    contractId: contract.contractId,
    localObjective: contract.localObjective,
    scenarioType: contract.scenarioType,
    workflowKind: contract.workflowKind,
    successCriteria: contract.successCriteria,
    failureCriteria: contract.failureCriteria,
    requiredEvidence: contract.requiredEvidence,
    allowedTools: contract.allowedTools,
    forbiddenActions: contract.forbiddenActions,
    riskLevel: contract.riskLevel,
    source: contract.source,
    verificationStatus: state?.contractVerification?.status,
    verificationScore: state?.contractVerification?.score,
    stopCondition: contract.stopCondition
  };
}

function buildObjectiveTraceSummary(state?: AgentGraphState): CockpitViewModel["objectiveTrace"] {
  const contract = state?.objectiveContract;
  const trace = state?.objectiveTrace;
  if (!contract && !trace && !state?.retrievedObjectiveTraces?.length) return undefined;
  return {
    similarTraceIds: state?.retrievedObjectiveTraces?.map((item) => item.traceId) ?? contract?.traceHints.similarTraceIds ?? [],
    lessonsReused: contract?.traceHints.reusedLessons ?? [],
    failurePatternsAvoided: contract?.traceHints.avoidedFailurePatterns ?? [],
    traceWritten: Boolean(trace),
    traceId: trace?.traceId,
    evidenceScore: trace?.evidenceSummary.evidenceScore,
    outcomeStatus: trace?.outcome.finalStatus,
    missingEvidence: trace?.evidenceSummary.missingEvidence ?? []
  };
}

function buildOrchestrationPolicySummary(state?: AgentGraphState): CockpitViewModel["orchestrationPolicy"] {
  const policy = state?.orchestrationPolicy;
  if (!policy) return undefined;
  const selected = state?.events.find((event) => event.type === "orchestration_policy_selected");
  const mode = selected?.type === "orchestration_policy_selected" ? selected.policyMode : "trace_guided";
  return {
    policyId: policy.policyId,
    mode,
    contractDepth: policy.contractPolicy.contractDepth,
    traceTopK: policy.tracePolicy.traceTopK,
    verificationStrictness: policy.verificationPolicy.verificationStrictness,
    repairRounds: policy.repairPolicy.maxRepairRounds,
    stopMode: policy.stopPolicy.stopMode,
    fitness: policy.metadata.fitness
  };
}

function buildSessionMeta(state: AgentGraphState | undefined, options: CockpitViewModelOptions): CockpitViewModel["sessionMeta"] {
  const source = options.source ?? (state ? "saved" : "empty");
  const fixtureMode = isFixtureSession(state);
  const connectionState = options.connectionState ?? (source === "live" ? "connected" : source === "api_unavailable" ? "unavailable" : "idle");
  return {
    source,
    sourceLabel: sourceLabel(source),
    connectionState,
    connectionLabel: connectionLabel(connectionState),
    fixtureMode,
    stale: options.stale ?? source === "saved",
    reconnectAttempts: options.reconnectAttempts ?? 0,
    message: options.message
  };
}

function sourceLabel(source: CockpitSessionSource): string {
  return {
    empty: "New task",
    saved: "Saved session",
    live: "Live session",
    api_unavailable: "API unavailable"
  }[source];
}

function connectionLabel(state: CockpitConnectionState): string {
  return {
    idle: "Not connected",
    connected: "Connected",
    disconnected: "Disconnected",
    reconnecting: "Reconnecting",
    unavailable: "Unavailable"
  }[state];
}

function buildWorkflow(state?: AgentGraphState, approval?: CockpitApproval): CockpitWorkflowStep[] {
  const events = new Set((state?.events ?? []).map((event) => event.type));
  const patchApplied = Boolean(state?.changedFiles.length);
  const failedShell = patchApplied && (state?.runResults.some((result) => !result.success) ?? false);
  const finalDone = Boolean(state?.finalSummary);
  return [
    step("plan", "Plan", Boolean(state?.plan), !state?.plan && Boolean(state), false, state?.plan?.steps[0]?.title ?? "Waiting for plan"),
    step("route", "Route", Boolean(state?.routing?.assignments.length), false, false, `${state?.routing?.mode ?? "balanced"} routing`),
    step("edit", "Edit", Boolean(state?.candidates.length || state?.repairCandidates.length), false, false, `${state?.candidates.length ?? 0} candidate(s)`),
    step("review", "Review", Boolean(state?.review), false, false, state?.review?.overallRecommendation ?? "Waiting for review"),
    step("test", "Test", patchApplied && Boolean(state?.runResults.length), false, failedShell, patchApplied ? state?.runResults.at(-1)?.command ?? "Waiting for tests" : "Waiting for tests"),
    step("judge", "Judge", Boolean(state?.judge), false, false, state?.judge?.reason ?? "Waiting for judgment"),
    step("approve", "Approve", events.has("patch_apply") || finalDone, Boolean(approval), false, approval?.title ?? state?.finalSummary?.result ?? "Waiting for approval")
  ];
}
function step(id: string, label: CockpitWorkflowStep["label"], done: boolean, running: boolean, failed: boolean, summary: string): CockpitWorkflowStep {
  return { id, label, status: failed ? "failed" : running ? "running" : done ? "done" : "pending", summary };
}

function buildRoutes(state?: AgentGraphState): CockpitRouteSummary[] {
  return (state?.routing.assignments ?? []).map((assignment) => ({
    role: assignment.role,
    provider: assignment.provider,
    model: assignment.model,
    reason: assignment.reason
  }));
}

function buildRoleGraphSummary(state?: AgentGraphState): CockpitViewModel["roleGraph"] {
  if (!state?.roleGraph) return undefined;
  return {
    workflowKind: state.roleGraph.workflowKind,
    nodes: state.roleGraph.nodes.map((node) => {
      const execution = state.roleGraphExecution?.nodes[node.id];
      return {
        id: node.id,
        role: node.role,
        required: node.required,
        dependencies: node.dependencies,
        canFallback: node.canFallback,
        canSkip: node.canSkip,
        maxRetries: node.maxRetries,
        produces: node.produces,
        consumes: node.consumes,
        status: execution?.status,
        attempts: execution?.attempts,
        startedAt: execution?.startedAt,
        endedAt: execution?.endedAt
      };
    }),
    stopConditions: state.roleGraph.stopConditions
  };
}

function buildTaskGraphSummary(state?: AgentGraphState): CockpitViewModel["taskGraph"] {
  const graph = state?.plan?.taskGraph;
  if (!graph) return undefined;
  return {
    workflowKind: graph.workflowKind,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      title: node.title,
      status: node.status,
      role: node.ownerRole,
      dependencies: node.dependsOn,
      evidenceRefs: node.evidenceRefs ?? [],
      artifactRefs: node.artifactRefs ?? []
    })),
    terminalNodeIds: graph.terminalNodeIds
  };
}

function buildErrorLoopTimeline(state?: AgentGraphState): CockpitViewModel["errorLoopTimeline"] {
  const relevantEvents = (state?.events ?? []).filter((event) => isErrorLoopEvent(event));
  if (!relevantEvents.length) return undefined;
  const items: CockpitErrorLoopTimelineItem[] = relevantEvents.map((event, index) => errorLoopItem(event, index));
  const shellItems = items.filter((item) => item.kind === "verification");
  return {
    candidateAttempts: items.filter((item) => item.kind === "candidate").length,
    outcomePredictions: items.filter((item) => item.kind === "prediction").length,
    outcomeMismatches: items.filter((item) => item.kind === "observation" && item.status === "mismatch").length,
    failedVerifications: shellItems.filter((item) => item.status === "failed").length,
    passedVerifications: shellItems.filter((item) => item.status === "passed").length,
    policyDecisions: items.filter((item) => item.kind === "policy").length,
    repairAttempts: items.filter((item) => item.kind === "repair").length,
    memoryRetrievals: items.filter((item) => item.kind === "memory").length,
    stopReason: [...items].reverse().find((item) => item.kind === "stop")?.summary,
    items
  };
}

function isErrorLoopEvent(event: TomorrowEdgeEvent): boolean {
  return event.type === "patch_candidate"
    || event.type === "outcome_prediction"
    || event.type === "patch_apply"
    || event.type === "shell_run"
    || event.type === "outcome_observation"
    || event.type === "repair_policy"
    || event.type === "repair_attempt"
    || event.type === "memory_retrieval"
    || event.type === "workflow_stop_reason";
}

function errorLoopItem(event: TomorrowEdgeEvent, index: number): CockpitErrorLoopTimelineItem {
  const base = {
    id: `${index}:${event.id}`,
    timestamp: event.timestamp,
    filesChanged: [] as string[],
    artifactRefs: [] as string[],
    memoryIds: [] as string[]
  };
  if (event.type === "patch_candidate") {
    return {
      ...base,
      kind: "candidate",
      status: "proposed",
      title: event.approach === "repair" ? "Repair candidate proposed" : "Patch candidate proposed",
      summary: event.summary,
      candidateId: event.candidateId,
      filesChanged: event.filesChanged,
      artifactRefs: compactRefs([event.diffRef])
    };
  }
  if (event.type === "outcome_prediction") {
    return {
      ...base,
      kind: "prediction",
      status: "proposed",
      title: "Outcome prediction",
      summary: `${event.target} predicts ${event.predictedOutcome}: ${event.expectedBehavior}`,
      candidateId: event.candidateId,
      command: event.command,
      filesChanged: event.expectedChangedFiles ?? [],
      artifactRefs: compactRefs([event.predictionRef])
    };
  }
  if (event.type === "patch_apply") {
    return {
      ...base,
      kind: "patch_apply",
      status: event.applied ? "applied" : "blocked",
      title: event.phase === "repair" ? "Repair patch application" : "Patch application",
      summary: event.error ?? `${event.filesChanged.length} file(s) changed`,
      candidateId: event.candidateId,
      filesChanged: event.filesChanged,
      artifactRefs: compactRefs([event.diffRef])
    };
  }
  if (event.type === "shell_run") {
    return {
      ...base,
      kind: "verification",
      status: event.success ? "passed" : event.success === false ? "failed" : "blocked",
      title: event.success ? "Verification passed" : event.success === false ? "Verification failed" : "Verification blocked",
      summary: event.error ?? `exit=${event.exitCode ?? "not recorded"}`,
      command: event.command,
      artifactRefs: compactRefs([event.stdoutRef, event.stderrRef]),
      exitCode: event.exitCode,
      durationMs: event.durationMs
    };
  }
  if (event.type === "outcome_observation") {
    return {
      ...base,
      kind: "observation",
      status: event.matched ? "matched" : "mismatch",
      title: "Outcome observation",
      summary: `${event.observedOutcome}${event.matched ? " matched prediction" : ` mismatch=${event.mismatchType}`}: ${event.summary}`,
      candidateId: event.candidateId,
      command: event.command,
      artifactRefs: compactRefs([event.observationRef])
    };
  }
  if (event.type === "repair_policy") {
    return {
      ...base,
      kind: "policy",
      status: event.action === "escalate" ? "escalated" : event.action === "repair" ? "allowed" : "blocked",
      title: "Repair policy decision",
      summary: `${event.failureClass} occurrence=${event.occurrence} action=${event.action}: ${event.reason}`
    };
  }
  if (event.type === "repair_attempt") {
    return {
      ...base,
      kind: "repair",
      status: event.applied === false ? "blocked" : "proposed",
      title: event.applied === false ? "Repair attempt blocked" : "Repair attempt proposed",
      summary: event.error ?? `${event.filesChanged.length} file(s) changed`,
      candidateId: event.candidateId,
      filesChanged: event.filesChanged,
      artifactRefs: compactRefs([event.diffRef])
    };
  }
  if (event.type === "memory_retrieval") {
    return {
      ...base,
      kind: "memory",
      status: event.selectedMemoryIds.length ? "used" : "blocked",
      title: `Failure memory ${event.retrievalStage}`,
      summary: event.summary,
      artifactRefs: compactRefs([event.artifactRef]),
      memoryIds: event.selectedMemoryIds
    };
  }
  return {
    ...base,
    kind: "stop",
    status: "stopped",
    title: "Workflow stopped",
    summary: event.type === "workflow_stop_reason" ? event.reason : eventSummary(event)
  };
}

function compactRefs(refs: Array<string | undefined>): string[] {
  return refs.filter((ref): ref is string => Boolean(ref));
}

function buildMemoryInfluence(state?: AgentGraphState): CockpitViewModel["memoryInfluence"] {
  const memory = state?.failureMemory;
  const events = (state?.events ?? []).filter((event) => event.type === "memory_retrieval");
  if (!memory && !events.length) return undefined;
  const cards: CockpitMemoryInfluenceCard[] = [];
  if (memory?.premortem) {
    const event = events.find((item) => item.retrievalStage === "premortem");
    cards.push({
      id: "memory-premortem",
      stage: "premortem",
      status: memory.premortem.selectedMemoryIds.length ? "accepted" : "filtered",
      injectedRole: "planner",
      memoryIds: memory.premortem.selectedMemoryIds,
      score: maxScore(memory.premortem.constraints),
      matchedFeatures: uniqueStrings(memory.premortem.constraints.map((constraint) => `${constraint.failureClass}:${constraint.kind}`)),
      decisionImpact: memory.premortem.constraints.length
        ? `Added ${memory.premortem.constraints.length} planner constraint/check item(s).`
        : "No planner constraint injected.",
      artifactRef: event?.artifactRef,
      constraints: memory.premortem.constraints.map((constraint) => constraint.text),
      violations: [],
      alignment: memory.premortem.extraChecks
    });
  }
  if (memory?.coderConstraints.length) {
    const event = events.find((item) => item.retrievalStage === "coder_constraints");
    cards.push({
      id: "memory-coder-constraints",
      stage: "coder_constraints",
      status: "accepted",
      injectedRole: "coder_a",
      memoryIds: uniqueStrings(memory.coderConstraints.map((constraint) => constraint.memoryId)),
      score: maxScore(memory.coderConstraints),
      matchedFeatures: uniqueStrings(memory.coderConstraints.map((constraint) => constraint.kind)),
      decisionImpact: `Shown to coder roles as ${memory.coderConstraints.length} compact constraint(s).`,
      artifactRef: event?.artifactRef,
      constraints: memory.coderConstraints.map((constraint) => constraint.text),
      violations: [],
      alignment: []
    });
  }
  for (const assessment of memory?.reviewAssessments ?? []) {
    const event = events.find((item) => item.retrievalStage === "review_guard");
    cards.push({
      id: `memory-review-${assessment.candidateId}`,
      stage: "review_guard",
      status: assessment.memoryViolations.length ? "contradicted" : "guarded",
      injectedRole: "reviewer",
      memoryIds: assessment.memoryIds,
      matchedFeatures: [`candidate:${assessment.candidateId}`],
      decisionImpact: assessment.memoryViolations.length
        ? `Candidate ${assessment.candidateId} was penalized by ${assessment.penalty}.`
        : `Candidate ${assessment.candidateId} aligned with retrieved memory checks.`,
      artifactRef: event?.artifactRef,
      constraints: [],
      violations: assessment.memoryViolations,
      alignment: assessment.memoryAlignment
    });
  }
  if (memory?.repairContext) {
    const event = events.find((item) => item.retrievalStage === "repair_context");
    cards.push({
      id: "memory-repair-context",
      stage: "repair_context",
      status: memory.repairContext.selectedMemoryIds.length ? "accepted" : "filtered",
      injectedRole: "repairer",
      memoryIds: memory.repairContext.selectedMemoryIds,
      score: maxScore(memory.repairContext.constraints),
      matchedFeatures: uniqueStrings(memory.repairContext.constraints.map((constraint) => `${constraint.failureClass}:${constraint.kind}`)),
      decisionImpact: memory.repairContext.corrections.length
        ? `Provided ${memory.repairContext.corrections.length} retrieved correction(s) to repairer.`
        : "No repair correction selected.",
      artifactRef: event?.artifactRef,
      constraints: memory.repairContext.corrections,
      violations: [],
      alignment: memory.repairContext.counterexamples
    });
  }
  if (!cards.length) return undefined;
  return {
    selectedCount: uniqueStrings(cards.flatMap((card) => card.memoryIds)).length,
    rejectedCount: events.reduce((sum, event) => sum + event.rejectedCount, 0),
    negativeTransferCandidates: cards.filter((card) => card.status === "contradicted").length,
    cards
  };
}

function isFixtureSession(state?: AgentGraphState): boolean {
  if (!state) return false;
  return state.routing.assignments.some((assignment) => assignment.provider === "fixture")
    || state.agents.some((agent) => agent.provider === "fixture" || agent.model.includes("fixture"))
    || state.candidates.some((candidate) => candidate.candidateId.includes("fixture") || candidate.summary.toLowerCase().includes("fixture"))
    || state.repairCandidates.some((candidate) => candidate.candidateId.includes("fixture") || candidate.summary.toLowerCase().includes("fixture"))
    || state.finalSummary?.evidence.some((item) => item.toLowerCase().includes("fixture")) === true
    || state.events.some((event) => event.type.includes("fixture"));
}

function buildApprovals(state?: AgentGraphState): CockpitApproval[] {
  if (!state) return [];
  const waiting = state.agents.some((agent) => agent.status === "waiting_for_user");
  if (state.finalSummary && state.finalSummary.result !== "partially_completed" && !waiting) return [];
  const approvals: CockpitApproval[] = [];
  const selected = selectedCandidate(state);
  const latestRun = state.runResults.at(-1);
  if (selected && hasActionablePatchCandidate(selected) && !hasPendingReReviewRequest(state) && (!state.changedFiles.length || waiting)) {
    const isRepair = selected.approach === "repair";
    approvals.push({
      id: `patch:${selected.candidateId}`,
      kind: isRepair ? "repair" : "patch",
      title: isRepair ? "Waiting for repair approval" : "Waiting for patch approval",
      status: isRepair ? state.approvals.repairApproved ? "approved" : "waiting" : state.changedFiles.length ? "approved" : "waiting",
      candidateId: selected.candidateId,
      filesChanged: selected.filesChanged,
      riskLevel: selected.estimatedRisk,
      testStatus: state.changedFiles.length && latestRun ? latestRun.success ? "passed" : "failed" : "not_run",
      summary: selected.summary,
      diff: selected.unifiedDiff
    });
  }
  if (state.changedFiles.length && !state.runResults.length) {
    const command = resolveCockpitShellCommand(state) ?? "verification command";
    approvals.push({
      id: "shell:test",
      kind: "shell",
      title: "Waiting for shell approval",
      status: state.approvals.shellApproved ? "approved" : "waiting",
      command,
      filesChanged: state.changedFiles,
      testStatus: "not_run",
      summary: "Patch is ready. Waiting for verification command authorization."
    });
  }
  return approvals;
}

function hasPendingReReviewRequest(state: AgentGraphState): boolean {
  const reviewEvents = state.events.filter((event) => event.type === "review_decision");
  const lastReview = reviewEvents.at(-1);
  return lastReview?.recommendation === "re_review_requested";
}

function hasActionablePatchCandidate(candidate: ReturnType<typeof selectedCandidate>): boolean {
  if (!candidate) return false;
  return Boolean(candidate.unifiedDiff.trim() || candidate.filesChanged.length);
}

function buildApprovalHistory(state: AgentGraphState | undefined, currentApproval?: CockpitApproval): CockpitApprovalHistoryItem[] {
  const items: CockpitApprovalHistoryItem[] = [];
  for (const event of state?.events ?? []) {
    if (event.type === "patch_apply") {
      if (isPendingPatchAuthorization(event)) continue;
      const undone = event.candidateId === "undo_latest_patch" || event.error === "undo_latest_patch";
      const rejected = !event.applied && !undone;
      items.push({
        id: event.id,
        approvalId: event.candidateId === "undo_latest_patch" ? "undo:latest_patch" : `patch:${event.candidateId}`,
        kind: undone ? "patch" : "patch",
        status: event.applied ? "approved" : "rejected",
        action: undone ? "undone" : event.applied ? "approved" : "rejected",
        actor: event.provider === "local_cockpit" ? "operator" : "cockpit",
        source: event.provider ?? "event-ledger",
        timestamp: event.timestamp,
        title: undone ? "Undo latest patch" : event.applied ? "Patch approved" : "Patch rejected",
        summary: event.error ?? `${event.filesChanged.length} file(s) changed`,
        blocksProgress: rejected,
        filterTags: compactTags(["patch", event.applied || undone ? "completed" : "rejected", undone ? "undo" : undefined]),
        candidateId: event.candidateId,
        filesChanged: event.filesChanged,
        diffRef: event.diffRef,
        undoSnapshotIds: event.undoSnapshotIds
      });
    }
    if (event.type === "shell_run") {
      const rejected = event.provider === "local_cockpit" && event.success === false;
      items.push({
        id: event.id,
        approvalId: "shell:test",
        kind: "shell",
        status: rejected ? "rejected" : "approved",
        action: rejected ? "rejected" : "approved",
        actor: event.provider === "local_cockpit" ? "operator" : "cockpit",
        source: event.provider ?? "event-ledger",
        timestamp: event.timestamp,
        title: rejected ? "Shell rejected" : `Shell ${event.success ? "passed" : "failed"}`,
        summary: event.error ?? `exit=${event.exitCode ?? "not recorded"}`,
        blocksProgress: rejected || event.success === false,
        filterTags: compactTags(["shell", rejected ? "rejected" : "completed"]),
        command: event.command,
        filesChanged: [],
        stdoutRef: event.stdoutRef,
        stderrRef: event.stderrRef,
        durationMs: event.durationMs
      });
    }
    if (event.type === "review_decision" && event.recommendation === "re_review_requested") {
      items.push({
        id: event.id,
        approvalId: "review:re_review_requested",
        kind: "review",
        status: "revision_requested",
        action: "revision_requested",
        actor: event.provider === "local_cockpit" ? "operator" : "reviewer",
        source: event.provider ?? "event-ledger",
        timestamp: event.timestamp,
        title: "Re-review requested",
        summary: event.recommendation,
        blocksProgress: true,
        filterTags: ["review", "pending"],
        filesChanged: []
      });
    }
  }
  if (currentApproval?.status === "waiting") {
    items.push({
      id: `waiting:${currentApproval.id}`,
      approvalId: currentApproval.id,
      kind: currentApproval.kind,
      status: "waiting",
      action: "waiting",
      actor: "operator",
      source: "browser_cockpit",
      timestamp: latestTimestamp(state?.events),
      title: currentApproval.title,
      summary: blockingSummary(currentApproval),
      blocksProgress: true,
      filterTags: compactTags([currentApproval.kind === "repair" ? "patch" : currentApproval.kind, "pending"]),
      candidateId: currentApproval.candidateId,
      command: currentApproval.command,
      filesChanged: currentApproval.filesChanged,
      diffRef: currentApproval.diff ? "inline:current-approval-diff" : undefined
    });
  }
  return items.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function isPendingPatchAuthorization(event: TomorrowEdgeEvent): boolean {
  return event.type === "patch_apply"
    && event.applied === false
    && /approval required/i.test(event.error ?? "");
}

function blockingSummary(approval: CockpitApproval): string {
  if (approval.kind === "shell") return `Workflow is waiting for shell authorization: ${approval.command ?? "verification command"}.`;
  if (approval.kind === "review") return "Workflow is waiting for another review pass.";
  return `Workflow is waiting for patch authorization for ${approval.filesChanged.join(", ") || approval.candidateId || "candidate"}.`;
}

function compactTags(tags: Array<CockpitApprovalHistoryItem["filterTags"][number] | undefined>): CockpitApprovalHistoryItem["filterTags"] {
  return tags.filter((tag): tag is CockpitApprovalHistoryItem["filterTags"][number] => Boolean(tag));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function maxScore(values: Array<{ score?: number }>): number | undefined {
  const scores = values.map((value) => value.score).filter((score): score is number => typeof score === "number");
  return scores.length ? Math.max(...scores) : undefined;
}

function buildTelemetry(state: AgentGraphState | undefined, routes: CockpitRouteSummary[], approval?: CockpitApproval): CockpitTelemetry {
  const agents = state?.agents ?? [];
  const usageFromEvents = deriveUsageFromEvents(state);
  const usage = state?.usageSummary?.totalTokens ? state.usageSummary : usageFromEvents ?? state?.usageSummary ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const routeFor = (role: string) => routes.find((route) => route.role === role);
  const currentCostUsd = usage.estimatedCostUsd;
  const budgetUsd = state?.budgetStatus?.maxCostUsd;
  const budgetDecisions = (state?.events ?? []).filter((event) => event.type === "budget_decision");
  const budgetUsedPercent = typeof currentCostUsd === "number" && typeof budgetUsd === "number" && budgetUsd > 0
    ? Math.min(100, Math.round((currentCostUsd / budgetUsd) * 100))
    : undefined;
  const budgetRemainingUsd = typeof currentCostUsd === "number" && typeof budgetUsd === "number"
    ? Math.max(0, budgetUsd - currentCostUsd)
    : undefined;
  return {
    plannerModel: formatRoute(routeFor("planner")),
    coderModel: formatRoute(routeFor("coder_a")),
    reviewerModel: formatRoute(routeFor("reviewer")),
    judgeModel: formatRoute(routeFor("judge")),
    providerSummary: [...new Set(routes.map((route) => route.provider))].slice(0, 4).join(" / ") || "offline",
    currentCostUsd,
    budgetUsd,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0,
    latencyMs: agents.reduce((sum, agent) => sum + (agent.elapsedMs ?? 0), 0),
    dispatched: agents.length,
    running: agents.filter((agent) => agent.status === "running").length,
    completed: agents.filter((agent) => agent.status === "success").length,
    waiting: agents.filter((agent) => agent.status === "waiting_for_user").length + (approval?.status === "waiting" ? 1 : 0),
    failed: agents.filter((agent) => agent.status === "failed").length,
    patchWaiting: approval?.kind === "patch" || approval?.kind === "repair",
    shellWaiting: approval?.kind === "shell",
    latestRiskLevel: approval?.riskLevel ?? selectedCandidate(state)?.estimatedRisk,
    decisionConfidence: state?.judge?.confidence,
    fallbackCount: (state?.events ?? []).filter((event) => event.type === "provider_fallback" || event.type === "fallback_to_native").length,
    realBudgetDecisions: budgetDecisions.filter((event) => event.realProvider).length,
    simulatedBudgetDecisions: budgetDecisions.filter((event) => event.simulated).length,
    realStrongAgentCallsUsed: state?.budgetRuntime.realStrongAgentCallsUsed ?? budgetDecisions.filter((event) => event.status === "allowed" && event.realProvider).length,
    simulatedStrongAgentCallsUsed: state?.budgetRuntime.simulatedStrongAgentCallsUsed ?? budgetDecisions.filter((event) => event.status === "allowed" && event.simulated).length,
    budgetUsedPercent,
    budgetRemainingUsd,
    roleCosts: buildRoleCosts(state?.modelNotes ?? [], currentCostUsd)
  };
}

function buildRoleCosts(notes: AgentGraphState["modelNotes"], totalCost?: number): CockpitTelemetry["roleCosts"] {
  const byRole = new Map<string, { model: string; costUsd: number }>();
  for (const note of notes) {
    const costUsd = note.estimatedCostUsd ?? 0;
    if (costUsd <= 0) continue;
    const existing = byRole.get(note.role);
    if (existing) {
      existing.costUsd += costUsd;
      continue;
    }
    byRole.set(note.role, { model: `${note.provider}/${note.model}`, costUsd });
  }
  const denominator = totalCost && totalCost > 0 ? totalCost : [...byRole.values()].reduce((sum, item) => sum + item.costUsd, 0);
  return [...byRole.entries()]
    .map(([role, item]) => ({
      role,
      model: item.model,
      costUsd: item.costUsd,
      percent: denominator > 0 ? Math.round((item.costUsd / denominator) * 100) : 0
    }))
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 8);
}

function deriveUsageFromEvents(state?: AgentGraphState): AgentGraphState["usageSummary"] | undefined {
  if (!state?.events.length) return undefined;
  const costEvents = state.events.filter((event) => event.type === "cost_usage");
  if (costEvents.length) {
    return costEvents.reduce((summary, event) => event.type === "cost_usage" ? {
      inputTokens: summary.inputTokens + event.inputTokens,
      outputTokens: summary.outputTokens + event.outputTokens,
      totalTokens: summary.totalTokens + event.totalTokens,
      estimatedCostUsd: (summary.estimatedCostUsd ?? 0) + (event.estimatedCostUsd ?? 0)
    } : summary, { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 });
  }
  const modelCalls = state.events.filter((event) => event.type === "model_call" && event.status === "success");
  if (!modelCalls.length) return undefined;
  return modelCalls.reduce((summary, event) => event.type === "model_call" ? {
    inputTokens: summary.inputTokens + (event.inputTokens ?? 0),
    outputTokens: summary.outputTokens + (event.outputTokens ?? 0),
    totalTokens: summary.totalTokens + (event.inputTokens ?? 0) + (event.outputTokens ?? 0),
    estimatedCostUsd: (summary.estimatedCostUsd ?? 0) + (event.estimatedCostUsd ?? 0)
  } : summary, { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 });
}

function buildMainView(state?: AgentGraphState, approval?: CockpitApproval): CockpitViewModel["main"] {
  if (approval) {
    return {
      title: approval.title,
      subtitle: approval.kind === "shell" ? approval.command ?? "shell command" : approval.candidateId ?? "patch candidate",
      body: approval.summary,
      diff: approval.diff,
      filesChanged: approval.filesChanged,
      riskLevel: approval.riskLevel,
      testStatus: approval.testStatus
    };
  }
  if (!state) {
    return { title: "Ready for a new task", subtitle: "Enter a natural-language command", body: "Offline fixture mode can run without API keys.", filesChanged: [] };
  }
  if (state.finalSummary) {
    if (isMissingPatchDeliverable(state)) {
      return {
        title: "No patch generated",
        subtitle: "needs revision",
        body: missingPatchBody(state),
        supportingDetail: completedBody(state),
        filesChanged: [],
        testStatus: "not_run"
      };
    }
    const failed = state.finalSummary.result === "failed" || state.finalSummary.result === "aborted";
    return {
      title: failed ? "Failure diagnosis" : "Answer",
      subtitle: state.finalSummary.result,
      body: state.finalSummary.userReply ?? "No model-generated user reply was recorded. Open Details for trace evidence.",
      supportingDetail: failed ? failureBody(state) : completedBody(state),
      filesChanged: state.changedFiles,
      testStatus: state.runResults.at(-1)?.success ? "passed" : state.runResults.length ? "failed" : "not_run"
    };
  }
  if (state.review) {
    return { title: "Review stage", subtitle: state.review.overallRecommendation, body: reviewBody(state), filesChanged: selectedCandidate(state)?.filesChanged ?? [], riskLevel: selectedCandidate(state)?.estimatedRisk };
  }
  if (state.plan) {
    return { title: "Plan and route", subtitle: `${state.routing.mode} route`, body: state.plan.steps.map((item) => `- ${item.title}`).join("\n"), filesChanged: [] };
  }
  return { title: "Workflow running", subtitle: state.goal, body: "Collecting context and generating candidate changes.", filesChanged: [] };
}

function missingPatchBody(state: AgentGraphState): string {
  const expected = state.plan?.expectedFiles?.length ? ` Expected files: ${state.plan.expectedFiles.join(", ")}.` : "";
  return [
    "No files were changed, and no patch is available to approve.",
    "The requested deliverable was not created, so this task needs revision or a retry with a patch-capable route.",
    expected.trim()
  ].filter(Boolean).join("\n");
}

function completedBody(state: AgentGraphState): string {
  const summary = state.finalSummary;
  if (!summary) return "";
  const sections = [
    `Task: ${summary.task}`,
    summary.changedFiles.length ? `Changed files: ${summary.changedFiles.join(", ")}` : "Changed files: none",
    summary.testsRun.length ? `Verification: ${summary.testsRun.join(", ")}` : "Verification: not run",
    "",
    "Result:",
    ...summary.evidence.map((item) => formatEvidenceItem(item)),
    summary.risksRemaining.length ? "" : undefined,
    summary.risksRemaining.length ? "Remaining risk:" : undefined,
    ...summary.risksRemaining.map((risk) => `- ${risk}`)
  ].filter((item): item is string => item !== undefined);
  return sections.join("\n");
}

function failureBody(state: AgentGraphState): string {
  const summary = state.finalSummary;
  const failedRun = [...state.runResults].reverse().find((result) => !result.success);
  const failedShell = [...state.events].reverse().find((event) => event.type === "shell_run" && event.success === false);
  const sections = [
    `Task: ${summary?.task ?? state.goal}`,
    failedRun ? `Root cause candidate: verification command failed (${failedRun.command}, exit=${failedRun.exitCode}).` : summary?.risksRemaining[0] ? `Root cause candidate: ${summary.risksRemaining[0]}` : "Root cause candidate: workflow stopped before a successful summary.",
    failedShell && failedShell.type === "shell_run" && failedShell.error ? `Shell error: ${failedShell.error}` : undefined,
    failedRun?.stdout ? `stdout:\n${clipText(stripAnsi(failedRun.stdout), 900)}` : undefined,
    failedRun?.stderr ? `stderr:\n${clipText(stripAnsi(failedRun.stderr), 900)}` : undefined,
    "",
    "Evidence:",
    ...(summary?.evidence.length ? summary.evidence.map((item) => formatEvidenceItem(item)) : ["- No summary evidence was recorded."]),
    "",
    "Next actions:",
    ...(summary?.risksRemaining.length ? summary.risksRemaining.map((risk) => `- ${risk}`) : ["- Open Details for raw events and artifacts.", "- Re-run with live models or request re-review if the diagnosis is incomplete."])
  ].filter((item): item is string => item !== undefined);
  return sections.join("\n");
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function formatEvidenceItem(item: string): string {
  const trimmed = item.trim();
  if (!trimmed) return "-";
  if (/^(artifacts|summaries|stdout|stderr|diffs|reviews|judgments)\//.test(trimmed)) return `- Artifact: ${trimmed}`;
  if (trimmed.includes("\n")) return trimmed;
  return `- ${trimmed}`;
}

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n... omitted ${value.length - maxChars} character(s)`;
}

function compactRawEvents(events: TomorrowEdgeEvent[]): TomorrowEdgeEvent[] {
  return events.map((event) => {
    if (event.type !== "context_select") return event;
    return {
      ...event,
      selectedFiles: sampleList(event.selectedFiles, 20),
      excludedFiles: sampleList(event.excludedFiles, 20)
    };
  });
}

function sampleList(values: string[], limit: number): string[] {
  if (values.length <= limit) return values;
  return [...values.slice(0, limit), `... ${values.length - limit} more`];
}
function selectedCandidate(state?: AgentGraphState) {
  const pendingRepair = state?.repairCandidates.at(-1);
  if (pendingRepair && state?.agents.some((agent) => agent.status === "waiting_for_user" && agent.role === "runner")) return pendingRepair;
  const candidates = [...(state?.candidates ?? []), ...(state?.repairCandidates ?? [])];
  return candidates.find((candidate) => candidate.candidateId === state?.judge?.selectedCandidateId) ?? candidates[0];
}

function reviewBody(state: AgentGraphState): string {
  return state.review?.reviews.map((review) => `${review.candidateId}: ${review.recommendation}, correctness=${review.correctnessScore}, risk=${review.riskScore}`).join("\n") ?? "";
}

function formatRoute(route?: CockpitRouteSummary): string | undefined {
  return route ? `${route.provider}/${route.model}` : undefined;
}

function latestTimestamp(events?: TomorrowEdgeEvent[]): string {
  return events?.at(-1)?.timestamp ?? new Date().toISOString();
}

function statusText(status: CockpitViewModel["status"]): string {
  return {
    idle: "Idle",
    planning: "Planning",
    routing: "Routing",
    editing: "Editing",
    reviewing: "Reviewing",
    testing: "Testing",
    waiting_approval: "Waiting approval",
    done: "Done",
    failed: "Failed"
  }[status];
}
function taskStatus(status: CockpitViewModel["status"]): "running" | "waiting" | "done" | "failed" {
  if (status === "done") return "done";
  if (status === "failed") return "failed";
  if (status === "waiting_approval") return "waiting";
  return "running";
}

function recentSyntheticTasks() {
  return [
    { id: "recent-docs", title: "[Demo] Update README and trace docs", status: "done" as const, updatedAt: "recent", reminder: "Demo task — add API key to run real workflows" },
    { id: "recent-mcp", title: "[Demo] MCP Agent Bridge smoke", status: "done" as const, updatedAt: "recent", reminder: "Demo task — add API key to run real workflows" }
  ];
}
export function artifactKindFromRef(ref: string): string {
  return path.basename(path.dirname(ref)) || "artifact";
}
