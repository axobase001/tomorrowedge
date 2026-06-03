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

  const openrouter = config.providers.openrouter;
  const openRouterKey = providerKey(config, "openrouter");
  if (isRegistrable(config, "openrouter")) {
    registry.register(createOpenRouterProvider(openRouterKey, providerModel(config, "openrouter", "OPENROUTER_MODEL", "openai/gpt-5.2"), openrouter.base_url, openrouter.api_format, openrouter.auth_header, openrouter.extra_headers));
  }

  const mimo = config.providers.mimo;
  if (isRegistrable(config, "mimo")) registry.register(createMimoProvider(mimo.base_url, providerKey(config, "mimo"), providerModel(config, "mimo", "MIMO_MODEL", "mimo-v2.5-pro"), mimo.api_format, mimo.auth_header, mimo.extra_headers));

  const openai = config.providers.openai_compatible;
  if (isRegistrable(config, "openai_compatible")) {
    registry.register(
      new OpenAICompatibleProvider({
        id: "openai_compatible",
        name: "OpenAI-compatible",
        apiKey: providerKey(config, "openai_compatible"),
        baseUrl: openai.base_url,
        defaultModel: providerModel(config, "openai_compatible", "OPENAI_COMPATIBLE_MODEL", "configured-model"),
        apiFormat: openai.api_format,
        authHeader: openai.auth_header,
        extraHeaders: openai.extra_headers
      })
    );
  }

  const deepseek = config.providers.deepseek;
  if (isRegistrable(config, "deepseek")) {
    registry.register(createDeepSeekProvider(deepseek.base_url, providerKey(config, "deepseek"), providerModel(config, "deepseek", "DEEPSEEK_MODEL", "deepseek-v4-pro"), deepseek.api_format, deepseek.auth_header, deepseek.extra_headers));
  }

  const kimi = config.providers.kimi;
  if (isRegistrable(config, "kimi")) {
    registry.register(createKimiProvider(kimi.base_url, providerKey(config, "kimi"), providerModel(config, "kimi", "KIMI_MODEL", "kimi-k2"), kimi.api_format, kimi.auth_header, kimi.extra_headers));
  }

  if (config.providers.anthropic?.enabled) registry.register(createAnthropicPlaceholder(process.env.ANTHROPIC_API_KEY));
  if (config.providers.gemini?.enabled) registry.register(createGeminiPlaceholder(process.env.GEMINI_API_KEY));

  if (config.providers.ollama?.enabled) {
    registry.register(new OllamaProvider(config.providers.ollama.base_url));
  }

  return registry;
}

function providerKey(config: TomorrowEdgeConfig, provider: string): string | undefined {
  const keyEnv = config.providers[provider]?.api_key_env;
  return keyEnv ? process.env[keyEnv] : undefined;
}

function providerModel(config: TomorrowEdgeConfig, provider: string, envName: string, fallback: string): string {
  const configured = config.providers[provider]?.model?.trim();
  if (configured) return configured;
  const fromEnv = process.env[envName]?.trim();
  return fromEnv || fallback;
}

function isRegistrable(config: TomorrowEdgeConfig, provider: string): boolean {
  const item = config.providers[provider];
  if (!item?.enabled || !item.base_url) return false;
  return item.auth_header === "none" || Boolean(providerKey(config, provider));
}
