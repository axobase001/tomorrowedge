import { PlaceholderProvider } from "./placeholderProvider.js";

export function createAnthropicPlaceholder(): PlaceholderProvider {
  return new PlaceholderProvider("anthropic", "Anthropic native adapter", "claude-opus-4.1", "Anthropic Messages API support is planned but not implemented in this build.");
}
