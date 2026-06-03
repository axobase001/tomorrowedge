import { OpenAICompatibleProvider } from "./openaiCompatible.js";

export function createAnthropicPlaceholder(apiKey?: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: "anthropic",
    name: "Anthropic placeholder",
    apiKey,
    baseUrl: ""
  });
}
