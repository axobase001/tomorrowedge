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
    case "conversation_target":
      return `target=${event.target} ${event.label}`;
    case "conversation_message":
      return `message to ${event.target}: ${event.summary}`;
    case "workflow_intent":
      return `${event.intent} patch=${event.requiresPatchWorkflow ? "yes" : "no"} confidence=${event.confidence.toFixed(2)}${event.fallbackUsed ? " fallback" : ""}: ${event.reason}`;
    case "external_agent_registered":
      return `registered ${event.externalAgentId} roles=${event.allowedRoles.join(",")}`;
    case "external_agent_call":
      return event.error ? `${event.externalAgentId} call ${event.status}: ${event.error}` : `${event.externalAgentId} call ${event.status}${event.tool ? ` tool=${event.tool}` : ""}`;
    case "external_agent_result":
      return `${event.externalAgentId} result: ${event.summary}`;
    case "external_agent_patch_candidate":
      return `${event.externalAgentId} candidate ${event.candidateId} ${event.filesChanged.length} files risk=${event.estimatedRisk}`;
    case "external_agent_review":
      return `${event.externalAgentId} review recommendation=${event.recommendation}`;
    case "external_agent_judgment":
      return `${event.externalAgentId} ${event.decision}${event.selectedCandidateId ? ` ${event.selectedCandidateId}` : ""}: ${event.reason}`;
    case "external_agent_error":
      return `${event.externalAgentId} error: ${event.error}`;
    case "external_agent_cost_usage":
      return `${event.externalAgentId} tokens=${event.totalTokens ?? ((event.inputTokens ?? 0) + (event.outputTokens ?? 0))}${event.estimatedCostUsd === undefined ? "" : ` cost=$${event.estimatedCostUsd.toFixed(6)}`}`;
    case "evidence_update":
      return `${event.evidence.length} evidence item(s)`;
    case "summary":
      return `result=${event.result}`;
    case "autonomy_limit_reached":
      return `${event.status}: ${event.reason}`;
    case "routing_decision":
      return `${event.assignedRole} -> ${event.assignedProvider}/${event.assignedModel}: ${event.reason}`;
    case "context_projection":
      return `${event.projectedArtifacts.length}/${event.selectedArtifacts.length} artifact views tokens~${event.tokenEstimate} omitted=${event.omittedBytes}`;
    case "artifact_projection":
      return `${event.artifactKind} ${event.artifactRef} -> ${event.policy} tokens~${event.tokenEstimate ?? 0}`;
    case "evidence_packet":
      return `${event.evidencePhase} ${event.verificationStatus}: ${event.summary}`;
    case "budget_decision":
      return `${event.status}: ${event.reason}${event.estimatedCostUsd === undefined ? "" : ` est=$${event.estimatedCostUsd.toFixed(6)}`}`;
    case "budget_preview":
      return `preview ${event.status}: ${event.reason}${event.estimatedCostUsd === undefined ? "" : ` est=$${event.estimatedCostUsd.toFixed(6)}`}`;
    case "workflow_stop_reason":
      return `${event.result}: ${event.reason}`;
    case "fallback_to_native":
      return `${event.fallbackRole} fallback: ${event.reason}`;
    case "trace_completeness":
      return `score=${event.score}${event.missing.length ? ` missing=${event.missing.join(",")}` : ""}`;
    case "agent_cache":
      return `${event.cache} cache ${event.status}: ${event.keyHint}`;
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
  if ("messageRef" in event && event.messageRef) refs.push(event.messageRef);
  if ("requestRef" in event && event.requestRef) refs.push(event.requestRef);
  if ("resultRef" in event && event.resultRef) refs.push(event.resultRef);
  if ("previewRef" in event && event.previewRef) refs.push(event.previewRef);
  if ("packetRef" in event && event.packetRef) refs.push(event.packetRef);
  return refs;
}
