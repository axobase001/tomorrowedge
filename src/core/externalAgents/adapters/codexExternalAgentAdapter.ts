import type { PatchCandidate } from "../../../schemas/patchCandidate.js";
import type { ReviewReport } from "../../../schemas/review.js";
import { makeId } from "../../../utils/ids.js";
import type { DebateIssue } from "../../debate/debateProtocol.js";
import { buildPatchEvidence } from "../../evidence/patchEvidence.js";
import { buildReviewEvidence } from "../../evidence/reviewEvidence.js";
import type { EvidencePacket } from "../../evidence/evidencePacket.js";
import type { ExternalAgentAdapterRuntime, ExternalAgentEvidenceInput, ExternalAgentOutputInput, ExternalAgentPromptInput } from "./externalAgentAdapter.js";
import { estimateExternalCost, normalizeGenericExternalAgentResult, type ExternalAgentNormalizationInput, type ExternalAgentNormalizationResult } from "./genericExternalAgentAdapter.js";

export const codexExternalAgentAdapter: ExternalAgentAdapterRuntime = {
  id: "codex",
  supports: (profile) => profile.adapter === "codex" || /codex/i.test(`${profile.id} ${profile.name}`),
  buildPrompt: buildCodexPrompt,
  normalizeOutput: normalizeCodexOutput,
  extractEvidence: extractCodexEvidence,
  extractEvidencePackets: extractCodexEvidencePackets,
  detectFailure: (input) => {
    if (input.normalized.status === "failed") {
      return { failed: true, reason: input.normalized.warnings.join("; ") || "Codex output failed typed normalization.", retryable: true, category: "malformed_output" };
    }
    if ((input.role === "coder_a" || input.role === "coder_b" || input.role === "repairer") && !candidateFromPayload(input.normalized.payload)) {
      return { failed: true, reason: "Codex coder output did not contain a patch candidate.", retryable: true, category: "missing_contract" };
    }
    if (input.role === "reviewer" && !reviewFromPayload(input.normalized.payload)) {
      return { failed: true, reason: "Codex reviewer output did not contain review data.", retryable: true, category: "missing_contract" };
    }
    return { failed: false };
  },
  retryPolicy: ({ failure, attempt }) => ({
    retry: Boolean(failure.retryable && attempt < 2),
    reason: failure.reason ?? "Codex adapter retry policy"
  }),
  estimateCost: estimateExternalCost
};

export function normalizeCodexExternalAgentResult(input: ExternalAgentNormalizationInput): ExternalAgentNormalizationResult {
  return codexExternalAgentAdapter.normalizeOutput({ ...input, adapter: "codex", responseMode: input.responseMode ?? "mixed", profile: codexProfileForLegacy(input) });
}

function buildCodexPrompt(input: ExternalAgentPromptInput): string {
  const header = [
    "You are Codex connected to TomorrowEdge as a role-bound coding agent.",
    "Do not write directly to the workspace unless the envelope explicitly asks for full-access execution.",
    `Role: ${input.role}`,
    `Output contract: ${input.envelope.outputContract}`
  ];
  const roleContract = roleInstructions(input.role);
  return [
    ...header,
    "",
    roleContract,
    "",
    "Return strict JSON matching the requested role contract. Include no markdown fences.",
    "Task envelope:",
    JSON.stringify(input.envelope, null, 2),
    "",
    "Original user-facing prompt:",
    input.prompt
  ].join("\n");
}

function roleInstructions(role: string): string {
  if (role === "coder_a" || role === "coder_b" || role === "repairer") {
    return [
      "Patch contract:",
      "{",
      "  \"summary\": string,",
      "  \"candidate\": {",
      "    \"candidateId\": string, \"agentId\": string, \"approach\": \"minimal_patch\"|\"alternative\"|\"repair\"|\"refactor\"|\"test_first\",",
      "    \"summary\": string, \"filesChanged\": string[], \"unifiedDiff\": string, \"testPlan\": string[],",
      "    \"knownTradeoffs\": string[], \"estimatedRisk\": \"low\"|\"medium\"|\"high\"",
      "  }",
      "}",
      "The unifiedDiff must be a git-style diff. If no safe patch exists, return status failed with a reason."
    ].join("\n");
  }
  if (role === "reviewer") {
    return [
      "Review contract:",
      "{",
      "  \"summary\": string,",
      "  \"review\": { \"mode\": \"standard\"|\"red_team\", \"reviews\": CandidateReview[], \"overallRecommendation\": string },",
      "  \"issues\"?: DebateIssue[]",
      "}",
      "Make blocking concerns candidate-scoped when they only apply to one candidate."
    ].join("\n");
  }
  return "Use the generic TomorrowEdge typed role contract.";
}

function normalizeCodexOutput(input: ExternalAgentOutputInput): ExternalAgentNormalizationResult {
  const generic = normalizeGenericExternalAgentResult({ ...input, adapter: "codex", responseMode: input.responseMode ?? "mixed" });
  let payload = generic.payload;
  const warnings = [...generic.warnings];

  if (input.role === "coder_a" || input.role === "coder_b" || input.role === "repairer") {
    const candidate = candidateFromPayload(payload) ?? candidateFromRawDiff(input.rawPayload, input.role);
    if (candidate) {
      const candidateWarnings = warnings.filter((warning) => !warning.includes("payload does not satisfy outputContract=patch"));
      payload = { summary: candidate.summary, candidate };
      return { ...generic, status: candidateWarnings.length ? "warning" : "success", warnings: candidateWarnings, payload, summary: candidate.summary || `Codex normalized ${input.role} patch candidate.` };
    }
    warnings.push("Codex patch output did not include candidate/unifiedDiff.");
  } else if (input.role === "reviewer") {
    const review = reviewFromPayload(payload);
    if (review) {
      const issues = issuesFromPayload(payload, review);
      payload = { summary: summaryFromPayload(payload, "Codex reviewer normalized review output."), review, issues };
      return { ...generic, status: warnings.length ? "warning" : "success", warnings, payload, summary: summaryFromPayload(payload, "Codex reviewer normalized review output.") };
    }
    warnings.push("Codex reviewer output did not include review/reviews.");
  }

  const strict = input.normalizationStrictness === "strict";
  const status = (strict || input.strictJson) && warnings.length ? "failed" : warnings.length ? "warning" : generic.status;
  return {
    ...generic,
    status,
    warnings,
    payload,
    summary: generic.summary.startsWith("External") ? `Codex adapter normalized ${input.role} ${input.outputContract} output.` : generic.summary
  };
}

function extractCodexEvidence(input: ExternalAgentEvidenceInput): string[] {
  const evidence: string[] = [];
  const candidate = candidateFromPayload(input.normalized.payload);
  if (candidate) {
    evidence.push(`codex_patch_candidate=${candidate.candidateId}`);
    evidence.push(`codex_files_changed=${candidate.filesChanged.join(",") || "none"}`);
    if (!candidate.unifiedDiff.trim()) evidence.push("codex_patch_missing_diff");
  }
  const review = reviewFromPayload(input.normalized.payload);
  if (review) {
    evidence.push(`codex_review_count=${review.reviews.length}`);
    for (const item of review.reviews) {
      if (item.recommendation === "reject" || item.recommendation === "revise") {
        evidence.push(`codex_review_issue:${item.candidateId}:${item.recommendation}`);
      }
    }
  }
  const issues = issuesFromPayload(input.normalized.payload, review);
  for (const issue of issues) evidence.push(`debate_issue:${issue.id}:${issue.candidateId ?? "global"}:${issue.title}`);
  if (input.normalized.warnings.length) evidence.push(`codex_normalization_warnings=${input.normalized.warnings.join("; ")}`);
  return evidence;
}

function extractCodexEvidencePackets(input: ExternalAgentEvidenceInput): EvidencePacket[] {
  const packets: EvidencePacket[] = [];
  const candidate = candidateFromPayload(input.normalized.payload);
  if (candidate) packets.push(buildPatchEvidence(candidate));
  const review = reviewFromPayload(input.normalized.payload);
  if (review) packets.push(buildReviewEvidence(review));
  return packets;
}

function candidateFromPayload(payload: unknown): PatchCandidate | undefined {
  const object = asRecord(payload);
  const candidate = asRecord(object?.candidate) ?? object;
  const unifiedDiff = stringOrUndefined(candidate?.unifiedDiff ?? candidate?.diff);
  if (unifiedDiff === undefined) return undefined;
  const role = stringOrUndefined(candidate?.agentId) ?? "coder_a";
  return {
    candidateId: stringOrUndefined(candidate?.candidateId) ?? makeId("external_codex_candidate"),
    agentId: role,
    approach: patchApproach(candidate?.approach, role),
    summary: stringOrUndefined(candidate?.summary) ?? stringOrUndefined(object?.summary) ?? "Codex patch candidate.",
    filesChanged: stringArray(candidate?.filesChanged).length ? stringArray(candidate?.filesChanged) : inferFilesFromDiff(unifiedDiff),
    unifiedDiff,
    testPlan: stringArray(candidate?.testPlan),
    knownTradeoffs: stringArray(candidate?.knownTradeoffs),
    estimatedRisk: patchRisk(candidate?.estimatedRisk)
  };
}

function candidateFromRawDiff(raw: unknown, role: string): PatchCandidate | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (!/(^diff --git |^---\s+|\n---\s+)/m.test(text) || !/^\+\+\+\s+/m.test(text)) return undefined;
  return {
    candidateId: makeId("external_codex_diff"),
    agentId: role,
    approach: role === "repairer" ? "repair" : role === "coder_b" ? "alternative" : "minimal_patch",
    summary: "Codex returned a raw unified diff.",
    filesChanged: inferFilesFromDiff(text),
    unifiedDiff: text,
    testPlan: [],
    knownTradeoffs: ["Raw diff normalized by Codex adapter."],
    estimatedRisk: "medium"
  };
}

function reviewFromPayload(payload: unknown): ReviewReport | undefined {
  const object = asRecord(payload);
  const reviewObject = asRecord(object?.review) ?? object;
  const reviews = Array.isArray(reviewObject?.reviews) ? reviewObject.reviews.map(normalizeReviewItem).filter(isDefined) : [];
  if (!reviews.length) return undefined;
  return {
    mode: reviewObject?.mode === "red_team" ? "red_team" : "standard",
    reviews,
    overallRecommendation: stringOrUndefined(reviewObject?.overallRecommendation) ?? stringOrUndefined(object?.summary) ?? "External Codex review normalized."
  };
}

function normalizeReviewItem(value: unknown): ReviewReport["reviews"][number] | undefined {
  const item = asRecord(value);
  if (!item) return undefined;
  return {
    candidateId: stringOrUndefined(item.candidateId) ?? "candidate",
    correctnessScore: boundedScore(item.correctnessScore, 50),
    riskScore: boundedScore(item.riskScore, 50),
    invasiveness: item.invasiveness === "high" || item.invasiveness === "medium" ? item.invasiveness : "low",
    testCoverage: item.testCoverage === "strong" || item.testCoverage === "adequate" || item.testCoverage === "weak" ? item.testCoverage : "none",
    securityConcerns: stringArray(item.securityConcerns),
    regressionConcerns: stringArray(item.regressionConcerns),
    redTeamFindings: [],
    recommendation: recommendation(item.recommendation),
    notes: stringArray(item.notes)
  };
}

function issuesFromPayload(payload: unknown, review?: ReviewReport): DebateIssue[] {
  const object = asRecord(payload);
  const direct = Array.isArray(object?.issues)
    ? object.issues.map((value): DebateIssue | undefined => {
        const issue = asRecord(value);
        if (!issue) return undefined;
        return {
          id: stringOrUndefined(issue.id) ?? makeId("external_codex_issue"),
          candidateId: stringOrUndefined(issue.candidateId),
          title: stringOrUndefined(issue.title) ?? stringOrUndefined(issue.summary) ?? "External Codex review issue",
          blocking: issue.blocking !== false,
          status: issue.status === "resolved" || issue.status === "rejected" ? issue.status : "open",
          requiredEvidence: stringArray(issue.requiredEvidence).length ? stringArray(issue.requiredEvidence) : ["review evidence"],
          relatedMoveIds: stringArray(issue.relatedMoveIds)
        } satisfies DebateIssue;
      }).filter(isDefined)
    : [];
  if (direct.length) return direct;
  return (review?.reviews ?? [])
    .flatMap((item) => [...item.securityConcerns, ...item.regressionConcerns].map((title) => ({
      id: makeId("external_codex_issue"),
      candidateId: item.candidateId,
      title,
      blocking: item.recommendation === "reject" || item.recommendation === "revise" || item.riskScore >= 70,
      status: "open" as const,
      requiredEvidence: ["review evidence"],
      relatedMoveIds: []
    })));
}

function codexProfileForLegacy(input: ExternalAgentNormalizationInput) {
  return {
    id: input.externalAgentId,
    name: "Codex",
    transport: "mcp" as const,
    adapter: "codex" as const,
    responseMode: input.responseMode,
    strictJson: input.strictJson,
    normalizationStrictness: input.normalizationStrictness,
    capabilities: [],
    allowedRoles: [input.role],
    trustLevel: "high" as const
  };
}

function inferFilesFromDiff(diff: string): string[] {
  return [...diff.matchAll(/^\+\+\+\s+(?:b\/)?(.+)$/gm)]
    .map((match) => match[1]?.trim())
    .filter((file): file is string => Boolean(file && file !== "/dev/null"));
}

function summaryFromPayload(payload: unknown, fallback: string): string {
  return stringOrUndefined(asRecord(payload)?.summary) ?? fallback;
}

function recommendation(value: unknown): ReviewReport["reviews"][number]["recommendation"] {
  return value === "accept" || value === "accept_with_minor_change" || value === "reject" || value === "revise" ? value : "revise";
}

function patchRisk(value: unknown): PatchCandidate["estimatedRisk"] {
  return value === "high" || value === "medium" || value === "low" ? value : "medium";
}

function patchApproach(value: unknown, role: string): PatchCandidate["approach"] {
  if (value === "minimal_patch" || value === "refactor" || value === "test_first" || value === "alternative" || value === "repair") return value;
  if (role === "repairer") return "repair";
  if (role === "coder_b") return "alternative";
  return "minimal_patch";
}

function boundedScore(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : fallback;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
