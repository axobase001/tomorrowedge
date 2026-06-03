import type { TomorrowEdgeConfig } from "../config/schema.js";
import { FixtureProvider } from "./fixtureProvider.js";
import { MockProvider } from "./mockProvider.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAICompatibleProvider } from "./openaiCompatible.js";
import { createOpenRouterProvider } from "./openrouter.js";
import { createMimoProvider } from "./mimo.js";
import { createDeepSeekProvider } from "./deepseek.js";
import { createKimiProvider } from "./kimi.js";
import { createAnthropicPlaceholder } from "./anthropic.js";
import { createGeminiPlaceholder } from "./gemini.js";
import type { ModelProvider } from "./types.js";

export class ProviderRegistry {
  private readonly providers = new Map<string, ModelProvider>();

  register(provider: ModelProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): ModelProvider | undefined {
    return this.providers.get(id);
  }

  list(): ModelProvider[] {
    return [...this.providers.values()];
  }
}

export function createProviderRegistry(config: TomorrowEdgeConfig): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(new MockProvider());
  registry.register(new FixtureProvider());

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (config.providers.openrouter?.enabled && openRouterKey) registry.register(createOpenRouterProvider(openRouterKey, process.env.OPENROUTER_MODEL ?? "openai/gpt-5.2"));

  const mimo = config.providers.mimo;
  if (mimo?.enabled && mimo.base_url && mimo.api_key_env) registry.register(createMimoProvider(mimo.base_url, process.env[mimo.api_key_env], process.env.MIMO_MODEL ?? "mimo-v2.5-pro"));

  const openai = config.providers.openai_compatible;
  if (openai?.enabled && openai.base_url && openai.api_key_env) {
    registry.register(
      new OpenAICompatibleProvider({
        id: "openai_compatible",
        name: "OpenAI-compatible",
        apiKey: process.env[openai.api_key_env],
        baseUrl: openai.base_url
      })
    );
  }

  const deepseek = config.providers.deepseek;
  if (deepseek?.enabled && deepseek.base_url && deepseek.api_key_env) {
    registry.register(createDeepSeekProvider(deepseek.base_url, process.env[deepseek.api_key_env], process.env.DEEPSEEK_MODEL ?? "deepseek-v4-pro"));
  }

  const kimi = config.providers.kimi;
  if (kimi?.enabled && kimi.base_url && kimi.api_key_env) {
    registry.register(createKimiProvider(kimi.base_url, process.env[kimi.api_key_env]));
  }

  if (config.providers.anthropic?.enabled) registry.register(createAnthropicPlaceholder(process.env.ANTHROPIC_API_KEY));
  if (config.providers.gemini?.enabled) registry.register(createGeminiPlaceholder(process.env.GEMINI_API_KEY));

  if (config.providers.ollama?.enabled) {
    registry.register(new OllamaProvider(config.providers.ollama.base_url));
  }

  return registry;
}
