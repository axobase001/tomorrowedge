import type { ProviderConfig } from "../config/schema.js";

export type OpenRouterCatalogModel = {
  id: string;
  name?: string;
  contextWindow?: number;
  promptPrice?: number;
  completionPrice?: number;
  isFree: boolean;
  isLowCost: boolean;
  tags: string[];
};

export type OpenRouterRecommendationOptions = {
  limit?: number;
  preferKimi?: boolean;
};

type RawOpenRouterModel = {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  top_provider?: { context_length?: unknown };
  pricing?: {
    prompt?: unknown;
    completion?: unknown;
  };
  architecture?: {
    modality?: unknown;
    input_modalities?: unknown;
    output_modalities?: unknown;
  };
};

export async function fetchOpenRouterCatalog(config: ProviderConfig, apiKey?: string): Promise<OpenRouterCatalogModel[]> {
  const baseUrl = config.base_url || "https://openrouter.ai/api/v1";
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, { headers });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenRouter model catalog failed: HTTP ${response.status}${detail ? ` ${detail.slice(0, 160)}` : ""}`);
  }
  const payload = (await response.json()) as { data?: RawOpenRouterModel[] };
  const models = Array.isArray(payload.data) ? payload.data : [];
  return models.map(normalizeOpenRouterModel).filter((model): model is OpenRouterCatalogModel => Boolean(model));
}

export function recommendFreeOpenRouterModels(models: OpenRouterCatalogModel[], options: OpenRouterRecommendationOptions = {}): OpenRouterCatalogModel[] {
  const limit = options.limit ?? 10;
  return [...models]
    .filter((model) => model.isFree || model.isLowCost)
    .sort((a, b) => scoreOpenRouterModel(b, options) - scoreOpenRouterModel(a, options) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export function formatOpenRouterModelLine(model: OpenRouterCatalogModel): string {
  const price = model.isFree ? "free" : `prompt ${formatPrice(model.promptPrice)} / completion ${formatPrice(model.completionPrice)}`;
  const context = model.contextWindow ? `${model.contextWindow} ctx` : "ctx unknown";
  const tags = model.tags.length ? ` [${model.tags.join(", ")}]` : "";
  return `${model.id} - ${model.name ?? model.id} (${context}, ${price})${tags}`;
}

function normalizeOpenRouterModel(raw: RawOpenRouterModel): OpenRouterCatalogModel | undefined {
  if (typeof raw.id !== "string" || !raw.id.trim()) return undefined;
  const id = raw.id.trim();
  const name = typeof raw.name === "string" ? raw.name : undefined;
  const promptPrice = parsePrice(raw.pricing?.prompt);
  const completionPrice = parsePrice(raw.pricing?.completion);
  const contextWindow = firstNumber(raw.context_length, raw.top_provider?.context_length);
  const isFree = id.includes(":free") || promptPrice === 0 || completionPrice === 0;
  const isLowCost = !isFree && Math.max(promptPrice ?? Number.POSITIVE_INFINITY, completionPrice ?? Number.POSITIVE_INFINITY) <= 0.0000035;
  const text = `${id} ${name ?? ""}`.toLowerCase();
  const modality = [
    raw.architecture?.modality,
    ...(Array.isArray(raw.architecture?.input_modalities) ? raw.architecture?.input_modalities : []),
    ...(Array.isArray(raw.architecture?.output_modalities) ? raw.architecture?.output_modalities : [])
  ]
    .filter((item): item is string => typeof item === "string")
    .join(" ")
    .toLowerCase();
  const tags = [
    text.includes("kimi") || text.includes("moonshot") ? "kimi" : "",
    text.includes("k2.6") || text.includes("2.6") ? "k2.6" : "",
    text.includes("deepseek") ? "deepseek" : "",
    text.includes("qwen") ? "qwen" : "",
    modality.includes("image") || modality.includes("vision") ? "vision" : "",
    contextWindow && contextWindow >= 128_000 ? "long-context" : ""
  ].filter(Boolean);
  return { id, name, contextWindow, promptPrice, completionPrice, isFree, isLowCost, tags };
}

function scoreOpenRouterModel(model: OpenRouterCatalogModel, options: OpenRouterRecommendationOptions): number {
  const text = `${model.id} ${model.name ?? ""}`.toLowerCase();
  let score = 0;
  if (model.isFree) score += 10_000;
  if (model.isLowCost) score += 1_000;
  if (options.preferKimi !== false && text.includes("kimi")) score += 3_000;
  if (options.preferKimi !== false && (text.includes("k2.6") || text.includes("2.6"))) score += 2_000;
  if (text.includes("deepseek") || text.includes("qwen")) score += 500;
  score += Math.min(model.contextWindow ?? 0, 1_000_000) / 1_000;
  return score;
}

function parsePrice(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function formatPrice(value: number | undefined): string {
  if (value === undefined) return "unknown";
  return value.toString();
}
