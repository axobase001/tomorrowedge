import type { TomorrowEdgeConfig } from "../config/schema.js";
import { FixtureProvider } from "./fixtureProvider.js";
import { MockProvider } from "./mockProvider.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAICompatibleProvider } from "./openaiCompatible.js";
import { createOpenRouterProvider } from "./openrouter.js";
import { createMimoProvider } from "./mimo.js";
import { createDeepSeekProvider } from "./deepseek.js";
import { createKimiProvider } from "./kimi.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createGeminiProvider } from "./gemini.js";
import type { ModelProvider } from "./types.js";

const staticProviderIds = new Set(["mock", "fixture", "openrouter", "mimo", "openai_compatible", "deepseek", "kimi", "anthropic", "gemini", "ollama"]);

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
    registry.register(createOpenRouterProvider(openRouterKey, providerModel(config, "openrouter", "OPENROUTER_MODEL", "openai/gpt-5.2"), openrouter.base_url, openrouter.api_format, openrouter.auth_header, openrouter.extra_headers, openrouter.requestTimeoutMs, openrouter.maxRetries, openrouter.retryBaseDelayMs));
  }

  const mimo = config.providers.mimo;
  if (isRegistrable(config, "mimo")) registry.register(createMimoProvider(mimo.base_url, providerKey(config, "mimo"), providerModel(config, "mimo", "MIMO_MODEL", "mimo-v2.5-pro"), mimo.api_format, mimo.auth_header, mimo.extra_headers, mimo.requestTimeoutMs, mimo.maxRetries, mimo.retryBaseDelayMs));

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
        extraHeaders: openai.extra_headers,
        requestTimeoutMs: openai.requestTimeoutMs,
        maxRetries: openai.maxRetries,
        retryBaseDelayMs: openai.retryBaseDelayMs
      })
    );
  }

  const deepseek = config.providers.deepseek;
  if (isRegistrable(config, "deepseek")) {
    registry.register(createDeepSeekProvider(deepseek.base_url, providerKey(config, "deepseek"), providerModel(config, "deepseek", "DEEPSEEK_MODEL", "deepseek-v4-pro"), deepseek.api_format, deepseek.auth_header, deepseek.extra_headers, deepseek.requestTimeoutMs, deepseek.maxRetries, deepseek.retryBaseDelayMs));
  }

  const kimi = config.providers.kimi;
  if (isRegistrable(config, "kimi")) {
    registry.register(createKimiProvider(kimi.base_url, providerKey(config, "kimi"), providerModel(config, "kimi", "KIMI_MODEL", "kimi-k2.6"), kimi.api_format, kimi.auth_header, kimi.extra_headers, kimi.requestTimeoutMs, kimi.maxRetries, kimi.retryBaseDelayMs));
  }

  const anthropic = config.providers.anthropic;
  if (isRegistrable(config, "anthropic")) {
    registry.register(createAnthropicProvider(providerKey(config, "anthropic"), providerModel(config, "anthropic", "ANTHROPIC_MODEL", "claude-sonnet-4-5"), anthropic.base_url, anthropic.extra_headers, anthropic.requestTimeoutMs));
  }
  const gemini = config.providers.gemini;
  if (isRegistrable(config, "gemini")) {
    registry.register(createGeminiProvider(providerKey(config, "gemini"), providerModel(config, "gemini", "GEMINI_MODEL", "gemini-2.5-pro"), gemini.base_url, gemini.extra_headers, gemini.requestTimeoutMs));
  }

  if (config.providers.ollama?.enabled) {
    registry.register(new OllamaProvider(process.env.OLLAMA_BASE_URL ?? config.providers.ollama.base_url));
  }

  for (const [providerId, provider] of Object.entries(config.providers)) {
    if (staticProviderIds.has(providerId) || !isRegistrable(config, providerId)) continue;
    registry.register(
      new OpenAICompatibleProvider({
        id: providerId,
        name: `Custom OpenAI-compatible (${providerId})`,
        apiKey: providerKey(config, providerId),
        baseUrl: provider.base_url,
        defaultModel: providerModel(config, providerId, providerModelEnvName(providerId), "configured-model"),
        apiFormat: provider.api_format,
        authHeader: provider.auth_header,
        extraHeaders: provider.extra_headers,
        requestTimeoutMs: provider.requestTimeoutMs,
        maxRetries: provider.maxRetries,
        retryBaseDelayMs: provider.retryBaseDelayMs
      })
    );
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

function providerModelEnvName(provider: string): string {
  const prefix = provider.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return `${prefix}_MODEL`;
}

function isRegistrable(config: TomorrowEdgeConfig, provider: string): boolean {
  const item = config.providers[provider];
  if (!item?.enabled || !item.base_url) return false;
  return item.auth_header === "none" || Boolean(providerKey(config, provider));
}
