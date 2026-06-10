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
    case "repair_policy":
      return `${event.failureClass} occurrence=${event.occurrence} action=${event.action}: ${event.reason}`;
    case "outcome_prediction":
      return `${event.target} predicts ${event.predictedOutcome}: ${event.expectedBehavior}`;
    case "outcome_observation":
      return `${event.target} observed ${event.observedOutcome}${event.matched ? " matched" : ` mismatch=${event.mismatchType}`}: ${event.summary}`;
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
    case "task_governance":
      return `sensitivity=${event.reasoningSensitivity} reviewer=${event.requiresReviewer ? "yes" : "no"} judge=${event.requiresJudge ? "yes" : "no"} confidence=${event.confidence.toFixed(2)}${event.fallbackUsed ? " fallback" : ""}: ${event.reason}`;
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
    case "external_agent_normalization":
      return `${event.externalAgentId} adapter=${event.adapter} ${event.status}: ${event.summary}`;
    case "evidence_update":
      return `${event.evidence.length} evidence item(s)`;
    case "evidence_gap":
      return `${event.blocking ? "blocking" : "nonblocking"} missing=${event.missing.join(",")}: ${event.reason}`;
    case "debate_move":
      return `${event.debateSessionId} r${event.round} ${event.speaker}/${event.moveType}: ${event.summary}`;
    case "debate_resolution":
      return `${event.resolution} coverage=${event.evidenceCoverageScore} unresolved=${event.unresolvedBlockingIssues.length}`;
    case "summary":
      return `result=${event.result}`;
    case "autonomy_limit_reached":
      return `${event.status}: ${event.reason}`;
    case "routing_decision":
      return `${event.assignedRole} -> ${event.assignedProvider}/${event.assignedModel}: ${event.reason}`;
    case "tool_skill_routing":
      return `selected=${event.selectedSkillIds.length} skipped=${event.skippedCount} blocked=${event.blockedCount} preference=${event.preference}: ${event.summary}`;
    case "context_projection":
      return `${event.projectedArtifacts.length}/${event.selectedArtifacts.length} artifact views tokens~${event.tokenEstimate} omitted=${event.omittedBytes}`;
    case "artifact_projection":
      return `${event.artifactKind} ${event.artifactRef} -> ${event.policy} tokens~${event.tokenEstimate ?? 0}`;
    case "evidence_packet":
      return `${event.evidencePhase} ${event.verificationStatus}: ${event.summary}`;
    case "budget_decision":
      return `${event.invocationKind ? `${event.invocationKind} ` : ""}${event.status}: ${event.reason}${event.estimatedCostUsd === undefined ? "" : ` est=$${event.estimatedCostUsd.toFixed(6)}`}`;
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
    case "memory_retrieval":
      return `${event.retrievalStage} selected=${event.selectedMemoryIds.length} rejected=${event.rejectedCount} constraints=${event.constraintCount}: ${event.summary}`;
    case "memory_policy":
      return `${event.retrievalStage} ${event.policyMode} ${event.action}: ${event.selectedAfter}/${event.selectedBefore} selected - ${event.reason}`;
    case "scenario_profile":
      return `${event.scenarioType}/${event.workflowKind} ambiguity=${event.ambiguityLevel} risks=${event.riskSignals.join(",") || "-"} deliverable=${event.expectedDeliverable}`;
    case "trace_retrieval":
      return `selected=${event.selectedTraceIds.length} rejected=${event.rejectedCount} mode=${event.policyMode}: ${event.summary}`;
    case "task_graph":
      return `nodes=${event.nodeCount} edges=${event.edgeCount} entry=${event.entryNodeIds.join(",") || "-"} terminal=${event.terminalNodeIds.join(",") || "-"}`;
    case "role_node_result":
      return `${event.nodeId} ${event.status}: ${event.summary}`;
    case "objective_contract":
      return `${event.contractId} ${event.scenarioType}/${event.workflowKind} risk=${event.riskLevel} source=${event.source}: ${event.localObjective}`;
    case "contract_verification":
      return `${event.status} score=${event.score}${event.missing.length ? ` missing=${event.missing.join(",")}` : ""}${event.violations.length ? ` violations=${event.violations.join(",")}` : ""}`;
    case "orchestration_policy_selected":
      return `${event.policyId} mode=${event.policyMode} contract=${event.contractDepth} traceTopK=${event.traceTopK} verify=${event.verificationStrictness} repair=${event.repairRounds} stop=${event.stopMode}`;
    case "orchestration_policy_scored":
      return `${event.policyId} fitness=${event.finalFitness}`;
    case "policy_mutation":
      return `${event.parentPolicyId} -> ${event.policyId}`;
    case "policy_evolution":
      return `evaluated=${event.evaluatedCount} selected=${event.selectedPolicyIds.join(",") || "-"}`;
    case "policy_counterfactual_replay":
      return `${event.policyId} trace=${event.traceId} simulated=${event.simulatedStatus} delta=${event.fitnessDelta}`;
    case "policy_tournament_result":
      return `winner=${event.winnerPolicyId} policies=${event.evaluatedPolicies} traces=${event.traceCount}`;
    case "objective_trace_written":
      return `${event.traceId} status=${event.outcomeStatus} evidence=${event.evidenceScore}`;
  }
}

export function renderEventMarkdown(events: TomorrowEdgeEvent[]): string {
  return events.map((event) => `- ${renderEventLine(event)}`).join("\n");
}

export function renderVerboseEventLine(event: TomorrowEdgeEvent): string {
  const refs = artifactRefs(event);
  const details = verboseDetails(event);
  return `${renderEventLine(event)}${details ? ` ${details}` : ""}${refs.length ? ` refs=${refs.join(",")}` : ""}`;
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
  if ("predictionRef" in event && event.predictionRef) refs.push(event.predictionRef);
  if ("observationRef" in event && event.observationRef) refs.push(event.observationRef);
  if ("artifactRef" in event && event.artifactRef) refs.push(event.artifactRef);
  if ("graphRef" in event && event.graphRef) refs.push(event.graphRef);
  if ("profileRef" in event && event.profileRef) refs.push(event.profileRef);
  if ("contractRef" in event && event.contractRef) refs.push(event.contractRef);
  if ("verificationRef" in event && event.verificationRef) refs.push(event.verificationRef);
  if ("policyRef" in event && event.policyRef) refs.push(event.policyRef);
  if ("fitnessRef" in event && event.fitnessRef) refs.push(event.fitnessRef);
  if ("mutationRef" in event && event.mutationRef) refs.push(event.mutationRef);
  if ("evolutionRef" in event && event.evolutionRef) refs.push(event.evolutionRef);
  if ("replayRef" in event && event.replayRef) refs.push(event.replayRef);
  if ("tournamentRef" in event && event.tournamentRef) refs.push(event.tournamentRef);
  if ("sessionRef" in event && event.sessionRef) refs.push(event.sessionRef);
  if ("traceRef" in event && event.traceRef) refs.push(event.traceRef);
  return refs;
}

function verboseDetails(event: TomorrowEdgeEvent): string {
  if (event.type !== "context_select") return "";
  const selected = samplePaths(event.selectedFiles, 5);
  const excluded = summarizeExcludedPaths(event.excludedFiles, 6);
  return [
    selected ? `selected=[${selected}]` : undefined,
    event.excludedFiles.length ? `excluded=${event.excludedFiles.length} [${excluded}]` : "excluded=0"
  ].filter(Boolean).join(" ");
}

function samplePaths(paths: string[], limit: number): string {
  if (!paths.length) return "";
  const sample = paths.slice(0, limit);
  const omitted = paths.length - sample.length;
  return `${sample.join(", ")}${omitted > 0 ? `, ... +${omitted}` : ""}`;
}

function summarizeExcludedPaths(paths: string[], limit: number): string {
  if (!paths.length) return "-";
  const groups = new Map<string, number>();
  for (const item of paths) {
    const key = excludedGroupKey(item);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const entries = [...groups.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const visible = entries.slice(0, limit).map(([key, count]) => `${key} x${count}`);
  const omitted = entries.length - visible.length;
  return `${visible.join(", ")}${omitted > 0 ? `, ... +${omitted} group(s)` : ""}`;
}

function excludedGroupKey(item: string): string {
  const normalized = item.replace(/\\/g, "/").replace(/^\.?\//, "");
  if (normalized.startsWith(".tomorrowedge/sessions/")) return ".tomorrowedge/sessions/**";
  if (normalized.startsWith(".tomorrowedge/")) return ".tomorrowedge/**";
  if (normalized.startsWith("node_modules/")) return "node_modules/**";
  if (normalized.startsWith("dist/")) return "dist/**";
  if (normalized.startsWith("coverage/")) return "coverage/**";
  const first = normalized.split("/")[0];
  return first || normalized || "(unknown)";
}
