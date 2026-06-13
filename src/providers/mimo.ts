import { OpenAICompatibleProvider } from "./openaiCompatible.js";
import type { ProviderApiFormat, ProviderAuthHeader } from "../config/schema.js";

export function createMimoProvider(baseUrl: string, apiKey?: string, defaultModel?: string, apiFormat: ProviderApiFormat = "openai_chat", authHeader: ProviderAuthHeader = "api-key", extraHeaders?: Record<string, string>, requestTimeoutMs?: number, maxRetries?: number, retryBaseDelayMs?: number): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: "mimo",
    name: "MiMo-compatible",
    apiKey,
    baseUrl,
    defaultModel,
    apiFormat,
    authHeader,
    extraHeaders,
    requestTimeoutMs,
    maxRetries,
    retryBaseDelayMs
  });
}
