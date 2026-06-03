import type { TomorrowEdgeEvent } from "./eventTypes.js";

export function renderEventLine(event: TomorrowEdgeEvent): string {
  const time = event.timestamp.slice(11, 19);
  const actor = event.role ? `${event.role}${event.provider ? ` / ${event.provider}${event.model ? `/${event.model}` : ""}` : ""}` : event.phase;
  return `[${time}] ${actor}: ${eventSummary(event)}`;
}

export function eventSummary(event: TomorrowEdgeEvent): string {
  switch (event.type) {
    case "access_mode":
      return `${event.description}`;
    case "model_call":
      return event.error
        ? `model call ${event.status ?? "failure"}: ${event.error}`
        : `model call ${event.status ?? "recorded"}${event.fallbackUsed ? " via fallback" : ""}${event.inputTokens || event.outputTokens ? ` tokens=${event.inputTokens ?? 0}/${event.outputTokens ?? 0}` : ""}`;
    case "agent_run":
      return event.error ? `agent run ${event.status}: ${event.error}` : `agent run ${event.status}`;
    case "context_select":
      return `selected ${event.selectedFiles.length} files`;
    case "file_read":
      return `read ${event.path}`;
    case "patch_candidate":
      return `${event.candidateId} ${event.filesChanged.length} files risk=${event.estimatedRisk}`;
    case "review_decision":
      return `review recommendation=${event.recommendation}`;
    case "judge_decision":
      return `${event.decision}${event.selectedCandidateId ? ` ${event.selectedCandidateId}` : ""}: ${event.reason}`;
    case "patch_apply":
      return event.applied ? `applied ${event.filesChanged.join(", ") || event.candidateId}` : `patch blocked: ${event.error ?? "not applied"}`;
    case "shell_run":
      return event.success === undefined ? `shell blocked: ${event.error ?? event.command}` : `${event.command} exit=${event.exitCode}`;
    case "repair_attempt":
      return event.applied ? `repair applied ${event.candidateId}` : `repair candidate ${event.candidateId}`;
    case "provider_fallback":
      return `${event.fromProvider}/${event.fromModel} -> ${event.toProvider}/${event.toModel}`;
    case "cost_usage":
      return `tokens=${event.totalTokens}${event.estimatedCostUsd === undefined ? "" : ` cost=$${event.estimatedCostUsd.toFixed(6)}`}`;
    case "evidence_update":
      return `${event.evidence.length} evidence item(s)`;
    case "summary":
      return `result=${event.result}`;
    case "autonomy_limit_reached":
      return `${event.status}: ${event.reason}`;
  }
}

export function renderEventMarkdown(events: TomorrowEdgeEvent[]): string {
  return events.map((event) => `- ${renderEventLine(event)}`).join("\n");
}

export function renderVerboseEventLine(event: TomorrowEdgeEvent): string {
  const refs = artifactRefs(event);
  return `${renderEventLine(event)}${refs.length ? ` refs=${refs.join(",")}` : ""}`;
}

export function artifactRefs(event: TomorrowEdgeEvent): string[] {
  const refs: string[] = [];
  if ("promptRef" in event && event.promptRef) refs.push(event.promptRef);
  if ("responseRef" in event && event.responseRef) refs.push(event.responseRef);
  if ("diffRef" in event && event.diffRef) refs.push(event.diffRef);
  if ("reviewRef" in event && event.reviewRef) refs.push(event.reviewRef);
  if ("decisionRef" in event && event.decisionRef) refs.push(event.decisionRef);
  if ("stdoutRef" in event && event.stdoutRef) refs.push(event.stdoutRef);
  if ("stderrRef" in event && event.stderrRef) refs.push(event.stderrRef);
  if ("evidenceRef" in event && event.evidenceRef) refs.push(event.evidenceRef);
  if ("summaryRef" in event && event.summaryRef) refs.push(event.summaryRef);
  return refs;
}
