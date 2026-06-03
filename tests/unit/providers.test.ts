import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { createProviderRegistry } from "../../src/providers/registry.js";
import { OpenAICompatibleProvider } from "../../src/providers/openaiCompatible.js";

describe("provider registry", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("registers offline providers without API keys", async () => {
    const registry = createProviderRegistry(defaultConfig);
    expect(registry.get("mock")).toBeTruthy();
    expect(registry.get("fixture")).toBeTruthy();
    const response = await registry.get("mock")!.chat({
      model: "mock-balanced",
      messages: [{ role: "user", content: "hello" }]
    });
    expect(response.content).toContain("Deterministic offline response");
  });

  it("registers configured provider models from config instead of hardcoded defaults", async () => {
    vi.stubEnv("OPENROUTER_TEST_KEY", "test-key");
    const registry = createProviderRegistry({
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        openrouter: {
          ...defaultConfig.providers.openrouter,
          enabled: true,
          api_key_env: "OPENROUTER_TEST_KEY",
          model: "anthropic/claude-opus-4.1"
        }
      }
    });

    const models = await registry.get("openrouter")?.listModels();
    expect(models?.[0]?.id).toBe("anthropic/claude-opus-4.1");
  });

  it("supports api-key auth and legacy max_tokens for OpenAI-compatible APIs", async () => {
    let observedHeaders: Headers | undefined;
    let observedBody: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", async (_input: string | URL | Request, init?: RequestInit) => {
      observedHeaders = new Headers(init?.headers);
      observedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: "ok", choices: [{ message: { content: "done" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const provider = new OpenAICompatibleProvider({
      id: "mimo",
      name: "MiMo-compatible",
      apiKey: "test-key",
      baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
      defaultModel: "mimo-v2.5-pro",
      apiFormat: "legacy_chat",
      authHeader: "api-key"
    });

    await provider.chat({
      model: "mimo-v2.5-pro",
      messages: [{ role: "user", content: "hello" }],
      maxCompletionTokens: 32
    });

    expect(observedHeaders?.get("api-key")).toBe("test-key");
    expect(observedHeaders?.get("Authorization")).toBeNull();
    expect(observedBody?.max_tokens).toBe(32);
    expect(observedBody?.max_completion_tokens).toBeUndefined();
  });
});
