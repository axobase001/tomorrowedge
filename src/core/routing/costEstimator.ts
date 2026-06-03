import type { ChatRequest, CostEstimate } from "../../providers/types.js";
import type { ModelProfile } from "./modelProfiles.js";

export function estimateProfileCost(req: ChatRequest, profile: ModelProfile): CostEstimate {
  const inputTokens = roughTokens(req.messages.map((message) => message.content).join("\n"));
  const outputTokens = 1200;
  const inputUsd = ((profile.inputPricePerMTok ?? 0) * inputTokens) / 1_000_000;
  const outputUsd = ((profile.outputPricePerMTok ?? 0) * outputTokens) / 1_000_000;
  return {
    inputUsd,
    outputUsd,
    totalUsd: inputUsd + outputUsd
  };
}

function roughTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
