import { OpenAICompatibleProvider } from "./openaiCompatible.js";

export function createGeminiPlaceholder(apiKey?: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: "gemini",
    name: "Gemini placeholder",
    apiKey,
    baseUrl: ""
  });
}
