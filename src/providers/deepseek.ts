import { OpenAICompatibleProvider } from "./openaiCompatible.js";

export function createDeepSeekProvider(baseUrl: string, apiKey?: string, defaultModel?: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: "deepseek",
    name: "DeepSeek-compatible",
    apiKey,
    baseUrl,
    defaultModel
  });
}
