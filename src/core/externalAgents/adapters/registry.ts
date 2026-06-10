import type { AgentRole } from "../../../schemas/agentTask.js";
import type { ExternalOutputContract } from "../contracts/externalTaskEnvelope.js";
import type { ExternalAgentAdapter, ExternalAgentProfile } from "../externalAgentTypes.js";
import { normalizeClaudeCodeExternalAgentResult } from "./claudeCodeExternalAgentAdapter.js";
import { normalizeCodexExternalAgentResult } from "./codexExternalAgentAdapter.js";
import { normalizeGenericExternalAgentResult, type ExternalAgentNormalizationResult } from "./genericExternalAgentAdapter.js";

export function normalizeExternalAgentResponse(input: {
  profile: ExternalAgentProfile;
  role: AgentRole;
  outputContract: ExternalOutputContract;
  rawPayload: unknown;
}): ExternalAgentNormalizationResult {
  const adapter: ExternalAgentAdapter = input.profile.adapter ?? inferAdapter(input.profile.id, input.profile.name);
  const responseMode = input.profile.responseMode ?? (input.profile.strictJson ? "json" : "mixed");
  const normalizationInput = {
    externalAgentId: input.profile.id,
    adapter,
    responseMode,
    role: input.role,
    outputContract: input.outputContract,
    rawPayload: input.rawPayload,
    strictJson: input.profile.strictJson,
    normalizationStrictness: input.profile.normalizationStrictness
  };
  if (adapter === "codex") return normalizeCodexExternalAgentResult(normalizationInput);
  if (adapter === "claude_code") return normalizeClaudeCodeExternalAgentResult(normalizationInput);
  return normalizeGenericExternalAgentResult(normalizationInput);
}

function inferAdapter(id: string, name: string): ExternalAgentAdapter {
  const value = `${id} ${name}`.toLowerCase();
  if (value.includes("claude")) return "claude_code";
  if (value.includes("codex")) return "codex";
  return "generic";
}
