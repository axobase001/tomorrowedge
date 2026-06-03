import { OpenAICompatibleProvider } from "./openaiCompatible.js";

export function createKimiProvider(baseUrl: string, apiKey?: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: "kimi",
    name: "Kimi-compatible",
    apiKey,
    baseUrl
  });
}
