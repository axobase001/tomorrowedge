import path from "node:path";
import type { AgentGraphState } from "../core/agentGraph/state.js";
import type { TomorrowEdgeEvent } from "../core/events/eventTypes.js";
import type { CockpitApproval, CockpitApprovalHistoryItem, CockpitConnectionState, CockpitRouteSummary, CockpitSessionSource, CockpitTelemetry, CockpitViewModel, CockpitWorkflowStep } from "./contracts.js";
import { buildCapabilityDashboard } from "./capabilityRegistry.js";
import { eventSummary, inferWorkflowStage, sessionTitle, workspaceLabel } from "./sessionSelectors.js";

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
    telemetry: buildTelemetry(state, routes, currentApproval),
    approvals,
    approvalHistory,
    capabilities: buildCapabilityDashboard(state),
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
    rawEvents: state?.events ?? [],
    artifacts: (state?.eventArtifacts ?? []).map((artifact) => ({
      ref: artifact.ref,
      kind: artifact.ref.split(/[\\/]/)[1] ?? "artifact"
    }))
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
  if (selected && (!state.changedFiles.length || waiting)) {
    approvals.push({
      id: `patch:${selected.candidateId}`,
      kind: selected.approach === "repair" ? "repair" : "patch",
      title: selected.approach === "repair" ? "Waiting for repair approval" : "Waiting for patch approval",
      status: state.changedFiles.length ? "approved" : "waiting",
      candidateId: selected.candidateId,
      filesChanged: selected.filesChanged,
      riskLevel: selected.estimatedRisk,
      testStatus: state.changedFiles.length && latestRun ? latestRun.success ? "passed" : "failed" : "not_run",
      summary: selected.summary,
      diff: selected.unifiedDiff
    });
  }
  if (state.changedFiles.length && !state.runResults.length) {
    approvals.push({
      id: "shell:test",
      kind: "shell",
      title: "Waiting for shell approval",
      status: state.approvals.shellApproved ? "approved" : "waiting",
      command: state.plan?.verificationCommands?.[0] ?? "npm test",
      filesChanged: state.changedFiles,
      testStatus: "not_run",
      summary: "Patch is ready. Waiting for verification command authorization."
    });
  }
  return approvals;
}

function buildApprovalHistory(state: AgentGraphState | undefined, currentApproval?: CockpitApproval): CockpitApprovalHistoryItem[] {
  const items: CockpitApprovalHistoryItem[] = [];
  for (const event of state?.events ?? []) {
    if (event.type === "patch_apply") {
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

function blockingSummary(approval: CockpitApproval): string {
  if (approval.kind === "shell") return `Workflow is waiting for shell authorization: ${approval.command ?? "verification command"}.`;
  if (approval.kind === "review") return "Workflow is waiting for another review pass.";
  return `Workflow is waiting for patch authorization for ${approval.filesChanged.join(", ") || approval.candidateId || "candidate"}.`;
}

function compactTags(tags: Array<CockpitApprovalHistoryItem["filterTags"][number] | undefined>): CockpitApprovalHistoryItem["filterTags"] {
  return tags.filter((tag): tag is CockpitApprovalHistoryItem["filterTags"][number] => Boolean(tag));
}

function buildTelemetry(state: AgentGraphState | undefined, routes: CockpitRouteSummary[], approval?: CockpitApproval): CockpitTelemetry {
  const agents = state?.agents ?? [];
  const usageFromEvents = deriveUsageFromEvents(state);
  const usage = state?.usageSummary?.totalTokens ? state.usageSummary : usageFromEvents ?? state?.usageSummary ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const routeFor = (role: string) => routes.find((route) => route.role === role);
  return {
    plannerModel: formatRoute(routeFor("planner")),
    coderModel: formatRoute(routeFor("coder_a")),
    reviewerModel: formatRoute(routeFor("reviewer")),
    judgeModel: formatRoute(routeFor("judge")),
    providerSummary: [...new Set(routes.map((route) => route.provider))].slice(0, 4).join(" / ") || "offline",
    currentCostUsd: usage.estimatedCostUsd,
    budgetUsd: state?.budgetStatus?.maxCostUsd,
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
    fallbackCount: (state?.events ?? []).filter((event) => event.type === "provider_fallback" || event.type === "fallback_to_native").length
  };
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
    const failed = state.finalSummary.result === "failed" || state.finalSummary.result === "aborted";
    return {
      title: failed ? "Failure diagnosis" : "Workflow complete",
      subtitle: state.finalSummary.result,
      body: failed
        ? [...state.finalSummary.evidence, ...state.finalSummary.risksRemaining.map((risk) => `Suggestion: ${risk}`)].join("\n")
        : state.finalSummary.evidence.join("\n"),
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
function selectedCandidate(state?: AgentGraphState) {
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
