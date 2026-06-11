import type { CockpitViewModel } from "../../../cockpit/contracts.js";
import type { Translator } from "../i18n.js";
import { EmptyState } from "./StateNotice.js";

export function DetailDrawer({ viewModel, open, t, onClose }: { viewModel: CockpitViewModel; open: boolean; t: Translator; onClose: () => void }) {
  if (!open) return null;
  const approvalHistoryText = formatApprovalHistory(viewModel);
  const capabilityText = formatCapabilities(viewModel);
  const routeText = formatRoutes(viewModel);
  const roleGraphText = formatRoleGraph(viewModel);
  const taskGraphText = formatTaskGraph(viewModel);
  const rawEventsText = viewModel.rawEvents.length ? JSON.stringify(viewModel.rawEvents.slice(-40), null, 2) : "";
  return (
    <>
      <div className="te-drawer-backdrop" onClick={onClose} data-testid="drawer-backdrop" />
      <aside className="te-drawer open" aria-hidden={false} data-testid="detail-drawer">
        <header>
          <h2>{t("drawer.title")}</h2>
          <button type="button" onClick={onClose} data-testid="detail-drawer-close">{t("drawer.close")}</button>
        </header>
      <h3>{t("drawer.objectiveContract")}</h3>
      <pre>{formatObjectiveContract(viewModel)}</pre>
      <h3>{t("drawer.objectiveTrace")}</h3>
      <pre>{formatObjectiveTrace(viewModel)}</pre>
      <h3>{t("drawer.orchestrationPolicy")}</h3>
      <pre>{formatOrchestrationPolicy(viewModel)}</pre>
      <h3>{t("drawer.approvalHistory")}</h3>
      {approvalHistoryText ? <pre>{approvalHistoryText}</pre> : <EmptyState title={t("state.noApprovalHistory")} testId="drawer-approval-empty-state" />}
      <h3>{t("drawer.memoryInfluence")}</h3>
      <div className="te-memory-list" data-testid="drawer-memory-influence">
        {viewModel.memoryInfluence?.cards.length ? viewModel.memoryInfluence.cards.map((card) => (
          <section key={card.id} className="te-memory-card">
            <div><strong>{card.stage}</strong> <span>{card.status}</span> <span>{card.injectedRole}</span></div>
            <p>{card.decisionImpact}</p>
            <p>ids={card.memoryIds.join(", ") || "-"}{card.score === undefined ? "" : ` score=${card.score}`}</p>
            <p>features={card.matchedFeatures.join(", ") || "-"}</p>
            {card.constraints.length ? <p>constraints={card.constraints.slice(0, 3).join(" | ")}</p> : null}
            {card.violations.length ? <p>violations={card.violations.join(" | ")}</p> : null}
            {card.alignment.length ? <p>alignment={card.alignment.slice(0, 3).join(" | ")}</p> : null}
            {card.artifactRef ? <a href={artifactHref(viewModel.sessionId, card.artifactRef)} target="_blank" rel="noreferrer">{card.artifactRef}</a> : null}
          </section>
        )) : <EmptyState title={t("state.noMemory")} detail={t("state.noMemoryDetail")} testId="drawer-memory-empty-state" />}
      </div>
      <h3>{t("drawer.errorLoopTimeline")}</h3>
      <div className="te-error-loop-list" data-testid="drawer-error-loop-timeline">
        {viewModel.errorLoopTimeline?.items.length ? (
          <>
            <p className="te-error-loop-summary">
              candidates={viewModel.errorLoopTimeline.candidateAttempts} predictions={viewModel.errorLoopTimeline.outcomePredictions} mismatches={viewModel.errorLoopTimeline.outcomeMismatches} failures={viewModel.errorLoopTimeline.failedVerifications} policies={viewModel.errorLoopTimeline.policyDecisions} repairs={viewModel.errorLoopTimeline.repairAttempts} memory={viewModel.errorLoopTimeline.memoryRetrievals}
            </p>
            {viewModel.errorLoopTimeline.items.map((item) => (
              <section key={item.id} className={`te-error-loop-item ${item.status}`}>
                <div><strong>{item.title}</strong> <span>{item.status}</span> <span>{item.kind}</span></div>
                <p>{item.summary}</p>
                {item.command ? <p>command={item.command}{item.exitCode === undefined ? "" : ` exit=${item.exitCode}`}</p> : null}
                {item.candidateId ? <p>candidate={item.candidateId}</p> : null}
                {item.filesChanged.length ? <p>files={item.filesChanged.join(", ")}</p> : null}
                {item.memoryIds.length ? <p>memory={item.memoryIds.join(", ")}</p> : null}
                {item.artifactRefs.length ? <p>artifacts={item.artifactRefs.join(", ")}</p> : null}
              </section>
            ))}
          </>
        ) : <EmptyState title={t("state.noErrorLoop")} detail={t("state.noErrorLoopDetail")} testId="drawer-error-loop-empty-state" />}
      </div>
      <h3>{t("drawer.capabilityDashboard")}</h3>
      {capabilityText ? <pre>{capabilityText}</pre> : <EmptyState title={t("state.noCapabilities")} testId="drawer-capabilities-empty-state" />}
      <h3>{t("drawer.diff")}</h3>
      <pre>{viewModel.main.diff || t("drawer.noDiff")}</pre>
      <h3>{t("drawer.routes")}</h3>
      {routeText ? <pre>{routeText}</pre> : <EmptyState title={t("state.noRouteDetails")} detail={t("state.noRoutesDetail")} testId="drawer-routes-empty-state" />}
      <h3>{t("drawer.roleGraph")}</h3>
      {roleGraphText ? <pre>{roleGraphText}</pre> : <EmptyState title={t("state.noRoleGraph")} testId="drawer-role-graph-empty-state" />}
      <h3>TaskGraph</h3>
      {taskGraphText ? <pre>{taskGraphText}</pre> : <EmptyState title="No task graph yet." testId="drawer-task-graph-empty-state" />}
      <h3>{t("drawer.artifacts")}</h3>
      <div className="te-artifact-list" data-testid="drawer-artifacts">
        {viewModel.artifacts.length ? viewModel.artifacts.map((artifact) => (
          <a key={artifact.ref} href={artifactHref(viewModel.sessionId, artifact.ref)} target="_blank" rel="noreferrer">{artifact.ref}</a>
        )) : <EmptyState title={t("state.noArtifacts")} detail={t("state.noArtifactsDetail")} testId="drawer-artifacts-empty-state" />}
      </div>
      <h3>{t("drawer.rawEvents")}</h3>
      {rawEventsText ? <pre>{rawEventsText}</pre> : <EmptyState title={t("state.noRawEvents")} testId="drawer-raw-events-empty-state" />}
    </aside>
    </>
  );
}

function formatApprovalHistory(viewModel: CockpitViewModel): string {
  return viewModel.approvalHistory.map((item) => [
    `${item.timestamp} ${item.approvalId} ${item.kind}/${item.status}`,
    `action=${item.action} actor=${item.actor} source=${item.source}`,
    item.blocksProgress ? "blocks=workflow progress is waiting on this approval" : "blocks=-",
    item.command ? `command=${item.command}` : undefined,
    item.candidateId ? `candidate=${item.candidateId}` : undefined,
    item.filesChanged.length ? `files=${item.filesChanged.join(", ")}` : undefined,
    item.diffRef ? `diff=${item.diffRef}` : undefined,
    item.stdoutRef ? `stdout=${item.stdoutRef}` : undefined,
    item.stderrRef ? `stderr=${item.stderrRef}` : undefined,
    item.undoSnapshotIds?.length ? `undo=${item.undoSnapshotIds.join(", ")}` : undefined,
    `filters=${item.filterTags.join(", ")}`
  ].filter(Boolean).join("\n")).join("\n\n");
}

function formatCapabilities(viewModel: CockpitViewModel): string {
  return viewModel.capabilities.map((capability) => [
    `${capability.label} [${capability.status}]`,
    `category=${capability.category}`,
    `readiness=${capability.readiness}`,
    `refs=${capability.refs.join(", ")}`
  ].join("\n")).join("\n\n");
}

function formatRoutes(viewModel: CockpitViewModel): string {
  return viewModel.routes.map((route) => [
    `${route.role} -> ${route.provider}/${route.model}`,
    route.reason ? `because ${route.reason}` : undefined
  ].filter(Boolean).join("\n")).join("\n\n");
}

function artifactHref(sessionId: string | undefined, ref: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId ?? "latest")}/artifacts/${encodeURIComponent(ref)}`;
}

function formatRoleGraph(viewModel: CockpitViewModel): string {
  const graph = viewModel.roleGraph;
  if (!graph) return "";
  const nodes = graph.nodes.map((node) => [
    `${node.id} (${node.role}) ${node.required ? "required" : "optional"} state=${node.status ?? "-"} attempts=${node.attempts ?? 0}`,
    `after=${node.dependencies.join(", ") || "-"}`,
    `fallback=${node.canFallback ? "yes" : "no"} skip=${node.canSkip ? "yes" : "no"} retries=${node.maxRetries}`,
    node.startedAt || node.endedAt ? `time=${node.startedAt ?? "-"} -> ${node.endedAt ?? "-"}` : undefined,
    node.consumes.length ? `consumes=${node.consumes.join(", ")}` : undefined,
    node.produces.length ? `produces=${node.produces.join(", ")}` : undefined
  ].filter(Boolean).join("\n"));
  return [
    `workflow=${graph.workflowKind}`,
    "",
    ...nodes,
    "",
    `stop=${graph.stopConditions.join(", ") || "-"}`
  ].join("\n");
}

function formatTaskGraph(viewModel: CockpitViewModel): string {
  const graph = viewModel.taskGraph;
  if (!graph) return "";
  const nodes = graph.nodes.map((node) => [
    `${node.id} (${node.kind}/${node.role}) status=${node.status}`,
    `after=${node.dependencies.join(", ") || "-"}`,
    node.evidenceRefs.length ? `evidence=${node.evidenceRefs.join(", ")}` : undefined,
    node.artifactRefs.length ? `artifacts=${node.artifactRefs.join(", ")}` : undefined
  ].filter(Boolean).join("\n"));
  return [
    `workflow=${graph.workflowKind ?? "-"}`,
    "",
    ...nodes,
    "",
    `terminal=${graph.terminalNodeIds.join(", ") || "-"}`
  ].join("\n");
}

function formatObjectiveContract(viewModel: CockpitViewModel): string {
  const contract = viewModel.objectiveContract;
  if (!contract) return "-";
  return [
    `id=${contract.contractId}`,
    `localObjective=${contract.localObjective}`,
    `scenario=${contract.scenarioType}`,
    `workflow=${contract.workflowKind}`,
    `risk=${contract.riskLevel}`,
    `source=${contract.source}`,
    `verification=${contract.verificationStatus ?? "-"} score=${contract.verificationScore ?? "-"}`,
    "",
    "successCriteria:",
    ...(contract.successCriteria ?? []).map((item) => `- ${item}`),
    "failureCriteria:",
    ...(contract.failureCriteria ?? []).map((item) => `- ${item}`),
    "requiredEvidence:",
    ...(contract.requiredEvidence ?? []).map((item) => `- ${item}`),
    `allowedTools=${(contract.allowedTools ?? []).join(", ") || "-"}`,
    `forbiddenActions=${(contract.forbiddenActions ?? []).join(", ") || "-"}`,
    "stopCondition:",
    `success=${(contract.stopCondition?.success ?? []).join(" | ") || "-"}`,
    `partial=${(contract.stopCondition?.partial ?? []).join(" | ") || "-"}`,
    `failure=${(contract.stopCondition?.failure ?? []).join(" | ") || "-"}`,
    `unsafe=${(contract.stopCondition?.unsafe ?? []).join(" | ") || "-"}`
  ].join("\n");
}

function formatObjectiveTrace(viewModel: CockpitViewModel): string {
  const trace = viewModel.objectiveTrace;
  if (!trace) return "-";
  return [
    `traceWritten=${trace.traceWritten ? "yes" : "no"}`,
    `traceId=${trace.traceId ?? "-"}`,
    `outcome=${trace.outcomeStatus ?? "-"}`,
    `evidenceScore=${trace.evidenceScore ?? "-"}`,
    `similarTraces=${(trace.similarTraceIds ?? []).join(", ") || "-"}`,
    `lessonsReused=${(trace.lessonsReused ?? []).join(" | ") || "-"}`,
    `failurePatternsAvoided=${(trace.failurePatternsAvoided ?? []).join(" | ") || "-"}`,
    `missingEvidence=${(trace.missingEvidence ?? []).join(", ") || "-"}`
  ].join("\n");
}

function formatOrchestrationPolicy(viewModel: CockpitViewModel): string {
  const policy = viewModel.orchestrationPolicy;
  if (!policy) return "-";
  return [
    `policyId=${policy.policyId}`,
    `mode=${policy.mode}`,
    `contractDepth=${policy.contractDepth}`,
    `traceTopK=${policy.traceTopK}`,
    `verificationStrictness=${policy.verificationStrictness}`,
    `repairRounds=${policy.repairRounds}`,
    `stopMode=${policy.stopMode}`,
    `fitness=${policy.fitness ?? "-"}`
  ].join("\n");
}
