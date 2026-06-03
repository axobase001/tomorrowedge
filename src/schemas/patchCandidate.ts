import { z } from "zod";

export const patchRiskSchema = z.enum(["low", "medium", "high"]);
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

export const livePatchResponseSchema = z.object({
  summary: z.string().optional().default(""),
  unifiedDiff: z.string().optional().default(""),
  filesChanged: z.array(z.string()).optional().default([]),
  testPlan: z.array(z.string()).optional().default([]),
  knownTradeoffs: z.array(z.string()).optional().default([]),
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
