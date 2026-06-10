import type { AgentRole } from "../../schemas/agentTask.js";
import type { JudgeDecision } from "../../schemas/judge.js";
import type { PatchCandidate } from "../../schemas/patchCandidate.js";
import type { ReviewReport } from "../../schemas/review.js";
import type { RunResult } from "../../schemas/evidence.js";
import type { EvidencePacket } from "./evidencePacket.js";

export type EvidenceDependencyGap = {
  role: AgentRole;
  missing: string;
  blocking: boolean;
  reason: string;
};

export type EvidenceDependencyInput = {
  role: AgentRole;
  candidates?: PatchCandidate[];
  review?: ReviewReport;
  judge?: JudgeDecision;
  evidencePackets?: EvidencePacket[];
  runResults?: RunResult[];
  changedFiles?: string[];
};

export function validateEvidenceDependencies(input: EvidenceDependencyInput): EvidenceDependencyGap[] {
  const gaps: EvidenceDependencyGap[] = [];
  if (input.role === "reviewer") {
    if (!input.candidates?.length) gaps.push(gap(input.role, "patch candidate", true, "Reviewer needs at least one candidate to inspect."));
    if (!hasEvidencePacket(input.evidencePackets, "patch")) gaps.push(gap(input.role, "patch evidence packet", false, "Reviewer prefers a patch evidence packet linked to candidate artifacts."));
  }
  if (input.role === "judge") {
    if (!input.review) gaps.push(gap(input.role, "review decision", true, "Judge cannot decide without reviewer output."));
    if (!input.candidates?.length) gaps.push(gap(input.role, "patch candidate", true, "Judge cannot select a missing candidate."));
    if (!hasEvidencePacket(input.evidencePackets, "review")) gaps.push(gap(input.role, "review evidence packet", false, "Judge prefers structured review evidence."));
  }
  if (input.role === "runner") {
    if (!input.judge || input.judge.decision !== "select") gaps.push(gap(input.role, "select judgment", true, "Runner should not mutate without a selected judge decision."));
    if (!input.judge?.selectedCandidateId) gaps.push(gap(input.role, "selected candidate id", true, "Runner needs the selected candidate id."));
  }
  if (input.role === "repairer") {
    if (!input.runResults?.some((result) => !result.success && !result.skipped)) gaps.push(gap(input.role, "failed verifier output", true, "Repairer needs a failing run to repair."));
    if (!input.changedFiles?.length) gaps.push(gap(input.role, "applied changed files", false, "Repairer should know which files were mutated before the verifier failed."));
  }
  if (input.role === "summarizer") {
    if (!input.evidencePackets?.length) gaps.push(gap(input.role, "evidence packet", false, "Summarizer should cite at least one evidence packet."));
  }
  return gaps;
}

function hasEvidencePacket(packets: EvidencePacket[] | undefined, phase: EvidencePacket["phase"]): boolean {
  return Boolean(packets?.some((packet) => packet.phase === phase));
}

function gap(role: AgentRole, missing: string, blocking: boolean, reason: string): EvidenceDependencyGap {
  return { role, missing, blocking, reason };
}
