import { normalizeGenericExternalAgentResult, type ExternalAgentNormalizationInput, type ExternalAgentNormalizationResult } from "./genericExternalAgentAdapter.js";

export function normalizeCodexExternalAgentResult(input: ExternalAgentNormalizationInput): ExternalAgentNormalizationResult {
  const normalized = normalizeGenericExternalAgentResult({ ...input, adapter: "codex", responseMode: input.responseMode ?? "mixed" });
  return {
    ...normalized,
    summary: normalized.summary.startsWith("External")
      ? `Codex adapter normalized ${input.role} ${input.outputContract} output.`
      : normalized.summary
  };
}
