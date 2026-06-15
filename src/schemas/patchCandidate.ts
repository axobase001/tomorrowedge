import { z } from "zod";

export const patchRiskSchema = z.preprocess((value) => normalizePatchRisk(value), z.enum(["low", "medium", "high"]));
export const patchApproachSchema = z.enum(["minimal_patch", "refactor", "test_first", "alternative", "repair"]);

export const patchCandidateSchema = z.object({
  candidateId: z.string(),
  agentId: z.string(),
  approach: patchApproachSchema,
  summary: z.string(),
  filesChanged: z.array(z.string()),
  unifiedDiff: z.string(),
  testPlan: z.array(z.string()),
  knownTradeoffs: z.array(z.string()),
  estimatedRisk: patchRiskSchema
});

const responseStringArraySchema = z.preprocess((value) => {
  if (typeof value === "string") return value.trim() ? [value] : [];
  return value;
}, z.array(z.string()));

export const livePatchResponseSchema = z.object({
  summary: z.string().optional().default(""),
  unifiedDiff: z.string().optional().default(""),
  filesChanged: z.array(z.string()).optional().default([]),
  testPlan: responseStringArraySchema.optional().default([]),
  knownTradeoffs: responseStringArraySchema.optional().default([]),
  estimatedRisk: patchRiskSchema.optional().default("low")
});

export type PatchCandidate = {
  candidateId: string;
  agentId: string;
  approach: "minimal_patch" | "refactor" | "test_first" | "alternative" | "repair";
  summary: string;
  filesChanged: string[];
  unifiedDiff: string;
  testPlan: string[];
  knownTradeoffs: string[];
  estimatedRisk: "low" | "medium" | "high";
};

function normalizePatchRisk(value: unknown): unknown {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
    if (["low", "minimal", "minor", "safe", "bounded"].includes(normalized) || normalized.includes("lowrisk")) return "low";
    if (["medium", "moderate", "normal"].includes(normalized) || normalized.includes("mediumrisk") || normalized.includes("moderaterisk")) return "medium";
    if (["high", "severe", "critical", "dangerous"].includes(normalized) || normalized.includes("highrisk") || normalized.includes("criticalrisk")) return "high";
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 0.67) return "high";
    if (value >= 0.34) return "medium";
    if (value >= 0) return "low";
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return normalizePatchRisk(record.level ?? record.risk ?? record.estimatedRisk ?? record.value);
  }
  return value;
}
