import type { AgentRole } from "../../../schemas/agentTask.js";
import type { ExternalOutputContract, ExternalTaskEnvelope } from "../contracts/externalTaskEnvelope.js";
import type { ExternalAgentAdapter, ExternalAgentProfile } from "../externalAgentTypes.js";
import { claudeCodeExternalAgentAdapter } from "./claudeCodeExternalAgentAdapter.js";
import { codexExternalAgentAdapter } from "./codexExternalAgentAdapter.js";
import type { ExternalAgentAdapterRuntime, ExternalAgentCostEstimate, ExternalAgentFailure, ExternalAgentRetryPolicy } from "./externalAgentAdapter.js";
import type { EvidencePacket } from "../../evidence/evidencePacket.js";
import { genericExternalAgentAdapter } from "./genericExternalAgentAdapter.js";
import type { ExternalAgentNormalizationResult } from "./genericExternalAgentAdapter.js";

const adapters: ExternalAgentAdapterRuntime[] = [
  codexExternalAgentAdapter,
  claudeCodeExternalAgentAdapter,
  genericExternalAgentAdapter
];

export function resolveExternalAgentAdapter(profile: ExternalAgentProfile): ExternalAgentAdapterRuntime {
  const adapterId: ExternalAgentAdapter = profile.adapter ?? inferAdapter(profile.id, profile.name);
  return adapters.find((adapter) => adapter.id === adapterId && adapter.supports(profile))
    ?? adapters.find((adapter) => adapter.id === adapterId)
    ?? genericExternalAgentAdapter;
}

export function buildExternalAgentPrompt(input: {
  profile: ExternalAgentProfile;
  role: AgentRole;
  envelope: ExternalTaskEnvelope;
  prompt: string;
}): string {
  return resolveExternalAgentAdapter(input.profile).buildPrompt(input);
}

export function normalizeExternalAgentResponse(input: {
  profile: ExternalAgentProfile;
  role: AgentRole;
  outputContract: ExternalOutputContract;
  rawPayload: unknown;
}): ExternalAgentNormalizationResult {
  const adapter = resolveExternalAgentAdapter(input.profile);
  const responseMode = input.profile.responseMode ?? (input.profile.strictJson ? "json" : "mixed");
  return adapter.normalizeOutput({
    externalAgentId: input.profile.id,
    adapter: adapter.id,
    responseMode,
    role: input.role,
    outputContract: input.outputContract,
    rawPayload: input.rawPayload,
    strictJson: input.profile.strictJson,
    normalizationStrictness: input.profile.normalizationStrictness,
    profile: input.profile
  });
}

export function extractExternalAgentEvidence(input: {
  profile: ExternalAgentProfile;
  role: AgentRole;
  outputContract: ExternalOutputContract;
  rawPayload: unknown;
  normalized: ExternalAgentNormalizationResult;
}): string[] {
  return resolveExternalAgentAdapter(input.profile).extractEvidence(input);
}

export function extractExternalAgentEvidencePackets(input: {
  profile: ExternalAgentProfile;
  role: AgentRole;
  outputContract: ExternalOutputContract;
  rawPayload: unknown;
  normalized: ExternalAgentNormalizationResult;
}): EvidencePacket[] {
  return resolveExternalAgentAdapter(input.profile).extractEvidencePackets?.(input) ?? [];
}

export function detectExternalAgentFailure(input: {
  profile: ExternalAgentProfile;
  role: AgentRole;
  outputContract: ExternalOutputContract;
  rawPayload: unknown;
  normalized: ExternalAgentNormalizationResult;
}): ExternalAgentFailure {
  return resolveExternalAgentAdapter(input.profile).detectFailure(input);
}

export function externalAgentRetryPolicy(input: {
  profile: ExternalAgentProfile;
  role: AgentRole;
  failure: ExternalAgentFailure;
  attempt: number;
}): ExternalAgentRetryPolicy {
  return resolveExternalAgentAdapter(input.profile).retryPolicy(input);
}

export function estimateExternalAgentCost(profile: ExternalAgentProfile, rawPayload: unknown): ExternalAgentCostEstimate {
  return resolveExternalAgentAdapter(profile).estimateCost(rawPayload);
}

function inferAdapter(id: string, name: string): ExternalAgentAdapter {
  const value = `${id} ${name}`.toLowerCase();
  if (value.includes("claude")) return "claude_code";
  if (value.includes("codex")) return "codex";
  return "generic";
}
