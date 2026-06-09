import type { ProviderAuthHeader, ProviderConfig } from "../config/schema.js";

export type ProviderCatalogModel = {
  id: string;
  label?: string;
  tags?: string[];
};

export async function fetchProviderModelCatalog(id: string, provider: ProviderConfig, apiKey?: string): Promise<ProviderCatalogModel[]> {
  if (!provider.base_url) throw new Error("base_url missing");
  if (provider.auth_header !== "none" && !apiKey) throw new Error(`missing env ${provider.api_key_env ?? "API key"}`);
  const request = providerCatalogRequest(id, provider, apiKey);
  const response = await fetch(request.url, request.init);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Model catalog failed: HTTP ${response.status}${detail ? ` ${detail.slice(0, 160)}` : ""}`);
  }
  const payload = await response.json();
  return parseProviderModels(id, payload);
}

function providerCatalogRequest(id: string, provider: ProviderConfig, apiKey?: string): { url: string; init: RequestInit } {
  const base = provider.base_url.replace(/\/$/, "");
  if (id === "ollama") {
    return {
      url: `${base}/api/tags`,
      init: { method: "GET", headers: provider.extra_headers ?? {} }
    };
  }
  return {
    url: `${base}/models`,
    init: {
      method: "GET",
      headers: {
        ...providerHeaders(id, provider.auth_header, apiKey),
        ...(provider.extra_headers ?? {})
      }
    }
  };
}

function providerHeaders(id: string, authHeader: ProviderAuthHeader, key?: string): Record<string, string> {
  if (authHeader === "none" || !key) return {};
  if (id === "anthropic") return { "x-api-key": key, "anthropic-version": "2023-06-01" };
  if (id === "gemini") return { "x-goog-api-key": key };
  if (authHeader === "api-key") return { "api-key": key };
  return { Authorization: `Bearer ${key}` };
}

function parseProviderModels(id: string, payload: unknown): ProviderCatalogModel[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  if (id === "ollama") {
    return parseModelArray(record.models, ["name"], ["name"]);
  }
  if (id === "gemini") {
    return parseModelArray(record.models, ["name"], ["displayName", "name"]).map((model) => ({
      ...model,
      id: model.id.replace(/^models\//, "")
    }));
  }
  return parseModelArray(record.data ?? record.models, ["id", "name"], ["name", "id"]);
}

function parseModelArray(value: unknown, idKeys: string[], labelKeys: string[]): ProviderCatalogModel[] {
  if (!Array.isArray(value)) return [];
  const models: ProviderCatalogModel[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const modelId = firstString(record, idKeys);
    if (!modelId) continue;
    models.push({
      id: modelId,
      label: firstString(record, labelKeys) ?? modelId,
      tags: tagsForModel(modelId, firstString(record, labelKeys))
    });
  }
  return dedupeModels(models);
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function tagsForModel(id: string, label?: string): string[] {
  const text = `${id} ${label ?? ""}`.toLowerCase();
  return [
    text.includes("kimi") || text.includes("moonshot") ? "kimi" : "",
    text.includes("deepseek") ? "deepseek" : "",
    text.includes("qwen") ? "qwen" : "",
    text.includes("gemini") ? "gemini" : "",
    text.includes("claude") ? "anthropic" : "",
    text.includes("vision") || text.includes("image") ? "vision" : ""
  ].filter(Boolean);
}

function dedupeModels(models: ProviderCatalogModel[]): ProviderCatalogModel[] {
  const seen = new Set<string>();
  const output: ProviderCatalogModel[] = [];
  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    output.push(model);
  }
  return output;
}
