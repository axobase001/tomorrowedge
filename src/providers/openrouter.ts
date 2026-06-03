import { OpenAICompatibleProvider } from "./openaiCompatible.js";

export function createOpenRouterProvider(apiKey?: string, defaultModel?: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: "openrouter",
    name: "OpenRouter",
    apiKey,
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel
  });
}
