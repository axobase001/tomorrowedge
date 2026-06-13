import { OpenAICompatibleProvider } from "./openaiCompatible.js";
import type { ProviderApiFormat, ProviderAuthHeader } from "../config/schema.js";

export function createDeepSeekProvider(baseUrl: string, apiKey?: string, defaultModel?: string, apiFormat: ProviderApiFormat = "openai_chat", authHeader: ProviderAuthHeader = "bearer", extraHeaders?: Record<string, string>, requestTimeoutMs?: number, maxRetries?: number, retryBaseDelayMs?: number): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: "deepseek",
    name: "DeepSeek-compatible",
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
