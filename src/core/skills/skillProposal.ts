import { createHash } from "node:crypto";
import type { ObjectiveTraceV1 } from "../traces/objectiveTrace.js";
import type { SkillManifestV1 } from "./skillTypes.js";

export type CandidateSkillProposalV1 = {
  schemaVersion: "candidate-skill/v1";
  proposalId: string;
  status: "candidate" | "needs_review" | "rejected";
  proposedSkill: SkillManifestV1;
  sourceTraceIds: string[];
  sourceMemoryIds: string[];
  scenarioType: string;
  workflowKind: string;
  confidence: number;
  riskLevel: "low" | "medium" | "high";
  reason: string;
  duplicateKey: string;
};

export type CandidateSkillProposalOptions = {
  minSupport?: number;
  minSuccessRate?: number;
  existingSkillIds?: string[];
};

export function proposeCandidateSkillsFromTraces(traces: ObjectiveTraceV1[], options: CandidateSkillProposalOptions = {}): CandidateSkillProposalV1[] {
  const minSupport = options.minSupport ?? 2;
  const minSuccessRate = options.minSuccessRate ?? 0.66;
  const groups = groupTraces(traces);
  const proposals: CandidateSkillProposalV1[] = [];
  for (const group of groups.values()) {
    const successRate = group.filter((trace) => trace.outcome.finalStatus === "success").length / group.length;
    if (group.length < minSupport || successRate < minSuccessRate) continue;
    const prototype = group[0]!;
    const skillId = `candidate.${prototype.scenarioProfile.scenarioType}.${prototype.planSummary.workflowKind}.${hashText(group.map((trace) => trace.traceId).sort().join(":")).slice(0, 8)}`;
    if (options.existingSkillIds?.includes(skillId)) continue;
    const verificationCommands = [...new Set(group.flatMap((trace) => trace.planSummary.verificationCommands).filter(Boolean))];
    const requiredTools = requiredToolsFromGroup(group);
    const riskLevel = highestRisk(group);
    const proposedSkill: SkillManifestV1 = {
      schemaVersion: "skill-manifest/v1",
      skillId,
      version: "0.1.0",
      name: `Candidate ${prototype.scenarioProfile.scenarioType} ${prototype.planSummary.workflowKind} skill`,
      description: `Proposed from ${group.length} similar successful objective trace(s).`,
      tags: ["candidate", prototype.scenarioProfile.scenarioType, prototype.planSummary.workflowKind],
      scenarios: [prototype.scenarioProfile.scenarioType],
      userStories: [prototype.goal],
      inputs: ["objective contract", "scenario profile", "selected context"],
      outputs: ["candidate procedure", "evidence packet"],
      requiredArtifacts: ["objective trace", "event ledger"],
      verificationCommands,
      requiredTools,
      permissions: {
        intents: requiredTools.includes("shell") ? ["read", "shell"] : ["read"],
        allowedTools: requiredTools,
        filesystem: { read: true, write: false, pathScope: "workspace" },
        shell: { allowed: requiredTools.includes("shell"), commands: verificationCommands },
        network: { allowed: false, hosts: [] },
        github: { read: requiredTools.includes("github"), write: false }
      },
      allowedAccessModes: requiredTools.includes("shell") ? ["partial", "full"] : ["restricted", "partial", "full"],
      riskLevel,
      provenance: "agent_candidate",
      lifecycle: "candidate",
      fixtures: [],
      sandbox: { required: true, profile: "fixture" },
      lifecycleHistory: [{
        to: "candidate",
        reason: "proposed from repeated objective traces",
        actor: "trace_memory",
        evidenceRefs: group.map((trace) => trace.traceId),
        at: new Date().toISOString()
      }]
    };
    proposals.push({
      schemaVersion: "candidate-skill/v1",
      proposalId: `skill_proposal_${hashText(skillId).slice(0, 12)}`,
      status: riskLevel === "high" ? "needs_review" : "candidate",
      proposedSkill,
      sourceTraceIds: group.map((trace) => trace.traceId),
      sourceMemoryIds: [],
      scenarioType: prototype.scenarioProfile.scenarioType,
      workflowKind: prototype.planSummary.workflowKind,
      confidence: Math.round(successRate * 100) / 100,
      riskLevel,
      reason: `Repeated ${prototype.scenarioProfile.scenarioType}/${prototype.planSummary.workflowKind} traces reached ${(successRate * 100).toFixed(0)}% success.`,
      duplicateKey: duplicateKeyFor(prototype)
    });
  }
  return suppressDuplicateProposals(proposals);
}

function groupTraces(traces: ObjectiveTraceV1[]): Map<string, ObjectiveTraceV1[]> {
  const groups = new Map<string, ObjectiveTraceV1[]>();
  for (const trace of traces) {
    if (trace.outcome.finalStatus === "unsafe" || trace.contractVerification.status === "failed") continue;
    const key = duplicateKeyFor(trace);
    groups.set(key, [...(groups.get(key) ?? []), trace]);
  }
  return groups;
}

function duplicateKeyFor(trace: ObjectiveTraceV1): string {
  const commands = trace.planSummary.verificationCommands.join(",");
  return `${trace.scenarioProfile.scenarioType}:${trace.planSummary.workflowKind}:${commands}`;
}

function requiredToolsFromGroup(group: ObjectiveTraceV1[]): string[] {
  const tools = new Set<string>(["repo_index", "file_read", "event_ledger"]);
  for (const trace of group) {
    for (const usage of trace.toolUsage ?? []) tools.add(usage.toolId);
    if (trace.executionSummary.shellRuns > 0) tools.add("shell");
    if (trace.executionSummary.filesTouched.length > 0) tools.add("patch_candidate");
  }
  return [...tools].sort();
}

function highestRisk(group: ObjectiveTraceV1[]): "low" | "medium" | "high" {
  if (group.some((trace) => trace.contract.riskLevel === "high")) return "high";
  if (group.some((trace) => trace.contract.riskLevel === "medium")) return "medium";
  return "low";
}

function suppressDuplicateProposals(proposals: CandidateSkillProposalV1[]): CandidateSkillProposalV1[] {
  const seen = new Set<string>();
  return proposals.filter((proposal) => {
    if (seen.has(proposal.duplicateKey)) return false;
    seen.add(proposal.duplicateKey);
    return true;
  });
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
