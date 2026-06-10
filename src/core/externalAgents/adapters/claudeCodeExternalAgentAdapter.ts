import { normalizeGenericExternalAgentResult, type ExternalAgentNormalizationInput, type ExternalAgentNormalizationResult } from "./genericExternalAgentAdapter.js";

export function normalizeClaudeCodeExternalAgentResult(input: ExternalAgentNormalizationInput): ExternalAgentNormalizationResult {
  const normalized = normalizeGenericExternalAgentResult({ ...input, adapter: "claude_code", responseMode: input.responseMode ?? "mixed" });
  return {
    ...normalized,
    summary: normalized.summary.startsWith("External")
      ? `Claude Code adapter normalized ${input.role} ${input.outputContract} output.`
      : normalized.summary
  };
}
