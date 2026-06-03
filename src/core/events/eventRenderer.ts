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
      return event.error ? `model call failed: ${event.error}` : `model call recorded${event.fallbackUsed ? " via fallback" : ""}`;
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
