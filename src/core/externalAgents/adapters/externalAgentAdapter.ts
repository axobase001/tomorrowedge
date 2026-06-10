import type { AgentRole } from "../../../schemas/agentTask.js";
import type { ExternalOutputContract, ExternalTaskEnvelope } from "../contracts/externalTaskEnvelope.js";
import type { ExternalAgentAdapter, ExternalAgentProfile } from "../externalAgentTypes.js";
import type { ExternalAgentNormalizationInput, ExternalAgentNormalizationResult } from "./genericExternalAgentAdapter.js";

export type ExternalAgentFailure = {
  failed: boolean;
  reason?: string;
  retryable?: boolean;
  category?: "malformed_output" | "missing_contract" | "empty_output" | "tool_error" | "role_mismatch";
};

export type ExternalAgentRetryPolicy = {
  retry: boolean;
  reason: string;
  delayMs?: number;
};

export type ExternalAgentCostEstimate = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
};

export type ExternalAgentPromptInput = {
  profile: ExternalAgentProfile;
  role: AgentRole;
  envelope: ExternalTaskEnvelope;
  prompt: string;
};

export type ExternalAgentOutputInput = ExternalAgentNormalizationInput & {
  profile: ExternalAgentProfile;
};

export type ExternalAgentEvidenceInput = {
  profile: ExternalAgentProfile;
  role: AgentRole;
  outputContract: ExternalOutputContract;
  rawPayload: unknown;
  normalized: ExternalAgentNormalizationResult;
};

export type ExternalAgentAdapterRuntime = {
  id: ExternalAgentAdapter;
  supports(profile: ExternalAgentProfile): boolean;
  buildPrompt(input: ExternalAgentPromptInput): string;
  normalizeOutput(input: ExternalAgentOutputInput): ExternalAgentNormalizationResult;
  extractEvidence(input: ExternalAgentEvidenceInput): string[];
  detectFailure(input: ExternalAgentEvidenceInput): ExternalAgentFailure;
  retryPolicy(input: { role: AgentRole; failure: ExternalAgentFailure; attempt: number }): ExternalAgentRetryPolicy;
  estimateCost(rawPayload: unknown): ExternalAgentCostEstimate;
};

