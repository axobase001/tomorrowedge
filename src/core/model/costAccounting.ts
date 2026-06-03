import type { ModelBudgetStatus, ModelNote, ModelUsageSummary } from "../../schemas/modelNote.js";
import type { ChatMessageContent } from "../../providers/types.js";

export type CostEstimateInput = {
  provider: string;
  prompt: string;
  maxOutputTokens: number;
  estimatedInputTokens?: number;
};

export function estimateCostUsd(provider: string, usage?: { inputTokens: number; outputTokens: number }): number | undefined {
  if (!usage) return undefined;
  const inputPrice = readPrice(provider, "INPUT");
  const outputPrice = readPrice(provider, "OUTPUT");
  if (inputPrice === undefined || outputPrice === undefined) return undefined;
  return roundUsd((usage.inputTokens / 1_000_000) * inputPrice + (usage.outputTokens / 1_000_000) * outputPrice);
}

export function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateMessageContentTokens(content: ChatMessageContent): number {
  if (typeof content === "string") return estimateTextTokens(content);
  return content.reduce((sum, part) => {
    if (part.type === "text") return sum + estimateTextTokens(part.text);
    return sum + 1200;
  }, 0);
}

export function preflightBudget(items: CostEstimateInput[], maxCostUsd: number): ModelBudgetStatus {
  let estimatedInputTokens = 0;
  let estimatedOutputTokens = 0;
  let estimatedCost = 0;
  let hasUnknownPrice = false;

  for (const item of items) {
    const inputTokens = item.estimatedInputTokens ?? estimateTextTokens(item.prompt);
    const outputTokens = item.maxOutputTokens;
    estimatedInputTokens += inputTokens;
    estimatedOutputTokens += outputTokens;
    const cost = estimateCostUsd(item.provider, { inputTokens, outputTokens });
    if (cost === undefined) {
      hasUnknownPrice = true;
      continue;
    }
    estimatedCost += cost;
  }

  if (hasUnknownPrice) {
    return {
      status: "price_unknown",
      maxCostUsd,
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedCostUsd: estimatedCost > 0 ? roundUsd(estimatedCost) : undefined,
      reason: "At least one routed provider has no configured price; budget cannot be enforced before the call."
    };
  }

  const roundedCost = roundUsd(estimatedCost);
  if (roundedCost > maxCostUsd) {
    return {
      status: "blocked",
      maxCostUsd,
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedCostUsd: roundedCost,
      reason: `Estimated live model cost $${roundedCost.toFixed(6)} exceeds max_cost_usd $${maxCostUsd.toFixed(6)}.`
    };
  }

  return {
    status: "within_budget",
    maxCostUsd,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd: roundedCost,
    reason: "Estimated live model cost is within configured budget."
  };
}

export function summarizeModelUsage(notes: ModelNote[]): ModelUsageSummary {
  const summary = notes.reduce(
    (acc, note) => {
      acc.inputTokens += note.usage?.inputTokens ?? 0;
      acc.outputTokens += note.usage?.outputTokens ?? 0;
      if (note.estimatedCostUsd !== undefined) {
        acc.cost += note.estimatedCostUsd;
        acc.hasCost = true;
      }
      return acc;
    },
    { inputTokens: 0, outputTokens: 0, cost: 0, hasCost: false }
  );

  return {
    inputTokens: summary.inputTokens,
    outputTokens: summary.outputTokens,
    totalTokens: summary.inputTokens + summary.outputTokens,
    estimatedCostUsd: summary.hasCost ? roundUsd(summary.cost) : undefined
  };
}

function readPrice(provider: string, direction: "INPUT" | "OUTPUT"): number | undefined {
  const value = process.env[`${provider.toUpperCase()}_${direction}_PRICE_PER_MTOK`];
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
