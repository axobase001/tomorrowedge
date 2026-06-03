import { OpenAICompatibleProvider } from "./openaiCompatible.js";

export function createMimoProvider(baseUrl: string, apiKey?: string, defaultModel?: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: "mimo",
    name: "MiMo-compatible",
    apiKey,
    baseUrl,
    defaultModel,
    extraHeaders: apiKey ? { "api-key": apiKey } : undefined
  });
}
