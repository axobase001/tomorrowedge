import type { ProviderAuthHeader, ProviderConfig, TomorrowEdgeConfig } from "../config/schema.js";

export type ProviderConnectionResult = {
  id: string;
  status: "ok" | "failed" | "skipped";
  httpStatus?: number;
  url?: string;
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
  const url = providerCatalogUrl(id, provider.base_url);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        ...providerHeaders(id, provider.auth_header, key),
        ...(provider.extra_headers ?? {})
      }
    });
    return {
      id,
      status: response.status >= 200 && response.status < 300 ? "ok" : "failed",
      httpStatus: response.status,
      url,
      detail: response.ok ? "HTTP 2xx from model catalog endpoint" : trimDetail(await response.text().catch(() => ""))
    };
  } catch (error) {
    return { id, status: "failed", url, detail: error instanceof Error ? error.message : String(error) };
  }
}

function authHeaders(authHeader: ProviderAuthHeader, key?: string): Record<string, string> {
  if (!key || authHeader === "none") return {};
  if (authHeader === "api-key") return { "api-key": key };
  return { Authorization: `Bearer ${key}` };
}

function providerCatalogUrl(id: string, baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}/models`;
}

function providerHeaders(id: string, authHeader: ProviderAuthHeader, key?: string): Record<string, string> {
  if (id === "anthropic" && key) return { "x-api-key": key, "anthropic-version": "2023-06-01" };
  if (id === "gemini" && key) return { "x-goog-api-key": key };
  return authHeaders(authHeader, key);
}

function trimDetail(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, 180) : "non-2xx response";
}
