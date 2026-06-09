import type { ProviderAuthHeader, ProviderConfig, TomorrowEdgeConfig } from "../config/schema.js";

export type ProviderConnectionResult = {
  id: string;
  status: "ok" | "failed" | "skipped";
  httpStatus?: number;
  url?: string;
  testedModel?: string;
  detail: string;
};

export async function testProviderConnections(config: TomorrowEdgeConfig, providerFilter?: string): Promise<ProviderConnectionResult[]> {
  const entries = Object.entries(config.providers).filter(([id]) => !providerFilter || id === providerFilter);
  if (providerFilter && !entries.length) throw new Error(`Unknown provider: ${providerFilter}`);
  const results: ProviderConnectionResult[] = [];
  for (const [id, provider] of entries) {
    results.push(await testProviderConnection(id, provider));
  }
  return results;
}

export async function testProviderConnection(id: string, provider: ProviderConfig): Promise<ProviderConnectionResult> {
  if (!provider.enabled) return { id, status: "skipped", detail: "provider disabled" };
  if (["mock", "fixture"].includes(id)) return { id, status: "skipped", detail: "offline provider does not need HTTP connectivity" };
  if (!provider.base_url) return { id, status: "failed", detail: "base_url missing" };
  const key = provider.api_key_env ? process.env[provider.api_key_env] : undefined;
  if (provider.auth_header !== "none" && !key) {
    return { id, status: "failed", detail: `missing env ${provider.api_key_env ?? "API key"}` };
  }
  if (!provider.model) return { id, status: "failed", detail: "model missing" };
  if (id === "ollama" && provider.model === "local-auto") {
    return { id, status: "skipped", detail: "select a concrete Ollama model before running a selected-model smoke test" };
  }
  const smoke = providerSmokeRequest(id, provider, key);
  try {
    const response = await fetch(smoke.url, smoke.init);
    return {
      id,
      status: response.status >= 200 && response.status < 300 ? "ok" : "failed",
      httpStatus: response.status,
      url: smoke.url,
      testedModel: provider.model,
      detail: response.ok ? `HTTP 2xx from selected model smoke endpoint (${provider.model})` : trimDetail(await response.text().catch(() => ""))
    };
  } catch (error) {
    return { id, status: "failed", url: smoke.url, testedModel: provider.model, detail: error instanceof Error ? error.message : String(error) };
  }
}

function authHeaders(authHeader: ProviderAuthHeader, key?: string): Record<string, string> {
  if (!key || authHeader === "none") return {};
  if (authHeader === "api-key") return { "api-key": key };
  return { Authorization: `Bearer ${key}` };
}

function providerSmokeRequest(id: string, provider: ProviderConfig, key?: string): { url: string; init: RequestInit } {
  const base = provider.base_url.replace(/\/$/, "");
  const commonHeaders = {
    "Content-Type": "application/json",
    ...providerHeaders(id, provider.auth_header, key),
    ...(provider.extra_headers ?? {})
  };
  if (id === "anthropic") {
    return {
      url: `${base}/messages`,
      init: {
        method: "POST",
        headers: commonHeaders,
        body: JSON.stringify({
          model: provider.model,
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }]
        })
      }
    };
  }
  if (id === "gemini") {
    const model = provider.model.replace(/^models\//, "");
    return {
      url: `${base}/models/${encodeURIComponent(model)}:generateContent`,
      init: {
        method: "POST",
        headers: commonHeaders,
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "ping" }] }],
          generationConfig: { maxOutputTokens: 1, temperature: 0 }
        })
      }
    };
  }
  if (id === "ollama") {
    return {
      url: `${base}/api/generate`,
      init: {
        method: "POST",
        headers: commonHeaders,
        body: JSON.stringify({
          model: provider.model === "local-auto" ? "" : provider.model,
          prompt: "ping",
          stream: false,
          options: { num_predict: 1, temperature: 0 }
        })
      }
    };
  }
  const tokenField = provider.api_format === "legacy_chat" ? "max_tokens" : "max_completion_tokens";
  return {
    url: `${base}/chat/completions`,
    init: {
      method: "POST",
      headers: commonHeaders,
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: "user", content: "ping" }],
        temperature: 0,
        [tokenField]: 1
      })
    }
  };
}

function providerHeaders(id: string, authHeader: ProviderAuthHeader, key?: string): Record<string, string> {
  if (authHeader === "none" || !key) return {};
  if (id === "anthropic") return { "x-api-key": key, "anthropic-version": "2023-06-01" };
  if (id === "gemini") return { "x-goog-api-key": key };
  return authHeaders(authHeader, key);
}

function trimDetail(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, 180) : "non-2xx response";
}
