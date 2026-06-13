import { OpenAICompatibleProvider } from "./openaiCompatible.js";
import type { ProviderApiFormat, ProviderAuthHeader } from "../config/schema.js";

export function createOpenRouterProvider(apiKey?: string, defaultModel?: string, baseUrl = "https://openrouter.ai/api/v1", apiFormat: ProviderApiFormat = "openai_chat", authHeader: ProviderAuthHeader = "bearer", extraHeaders?: Record<string, string>, requestTimeoutMs?: number, maxRetries?: number, retryBaseDelayMs?: number): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: "openrouter",
    name: "OpenRouter",
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
