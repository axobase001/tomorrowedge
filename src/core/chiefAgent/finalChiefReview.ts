import type { EventArtifact } from "../events/eventTypes.js";
import type { EvidencePacket } from "../evidence/evidencePacket.js";
import type { TaskGraph } from "../planning/taskGraph.js";
import type { DelegatedTaskResult } from "../delegatedExecution/delegatedExecutionTypes.js";

export type FinalChiefReview = {
  chiefAgentId: string;
  decision:
    | "approve_delivery"
    | "request_revision"
    | "ask_user"
    | "abort";
  architectureConsistency: "pass" | "warning" | "fail";
  codeReviewSummary: string;
  taskCompletionSummary: string;
  unresolvedRisks: string[];
  requiredRevisions: string[];
  evidenceRefs: string[];
  artifactRefs: string[];
};

export function runFinalChiefReview(input: {
  chiefAgentId: string;
  taskGraph: TaskGraph;
  delegatedResults: DelegatedTaskResult[];
  evidencePackets: EvidencePacket[];
  artifacts: EventArtifact[];
  mutationCount: number;
}): FinalChiefReview {
  const latestResults = latestResultPerTask(input.delegatedResults);
  const failed = latestResults.filter((result) => result.status === "failed" || result.status === "blocked");
  const missingEvidenceNodes = input.taskGraph.nodes.filter((node) => node.requiredEvidence.length > 0 && !(node.evidenceRefs?.length));
  const unresolvedRisks = [
    ...failed.flatMap((result) => result.failureSignals ?? [`${result.taskNodeId} did not complete successfully`]),
    ...missingEvidenceNodes.map((node) => `${node.id} has required evidence but no evidence refs`)
  ];
  const evidenceRefs = [
    ...latestResults.flatMap((result) => result.evidenceRefs),
    ...input.evidencePackets.map((packet) => packet.id)
  ];
  const artifactRefs = [
    ...latestResults.flatMap((result) => result.artifactRefs),
    ...input.artifacts.map((artifact) => artifact.ref)
  ];
  const requiredRevisions = failed.map((result) => `Revise ${result.taskNodeId}: ${result.failureSignals?.join("; ") || result.status}`);
  const decision = unresolvedRisks.length ? "request_revision" : "approve_delivery";
  return {
    chiefAgentId: input.chiefAgentId,
    decision,
    architectureConsistency: failed.length ? "fail" : input.mutationCount > 0 ? "warning" : "pass",
    codeReviewSummary: failed.length
      ? `Chief review found ${failed.length} blocked/failed delegated task(s).`
      : "Chief review found the delegated task graph internally consistent with the evidence bundle.",
    taskCompletionSummary: `${latestResults.filter((result) => result.status === "success").length}/${input.taskGraph.nodes.length} task nodes completed; mutations=${input.mutationCount}.`,
    unresolvedRisks,
    requiredRevisions,
    evidenceRefs: [...new Set(evidenceRefs)],
    artifactRefs: [...new Set(artifactRefs)]
  };
}

function latestResultPerTask(results: DelegatedTaskResult[]): DelegatedTaskResult[] {
  const byTask = new Map<string, DelegatedTaskResult>();
  for (const result of results) byTask.set(result.taskNodeId, result);
  return [...byTask.values()];
}
