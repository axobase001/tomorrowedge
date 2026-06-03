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

  it("retries transient OpenAI-compatible API failures", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("rate limited", { status: 429 });
      }
      return new Response(JSON.stringify({ id: "ok", choices: [{ message: { content: "done" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const provider = new OpenAICompatibleProvider({
      id: "openrouter",
      name: "OpenRouter",
      apiKey: "test-key",
      baseUrl: "https://openrouter.ai/api/v1",
      defaultModel: "openai/gpt-5.2",
      retryBaseDelayMs: 0
    });

    const response = await provider.chat({
      model: "openai/gpt-5.2",
      messages: [{ role: "user", content: "hello" }]
    });

    expect(response.content).toBe("done");
    expect(calls).toBe(2);
  });

  it("registers Anthropic and Gemini as explicit placeholders instead of OpenAI-compatible shims", async () => {
    const registry = createProviderRegistry({
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        anthropic: { ...defaultConfig.providers.anthropic, enabled: true },
        gemini: { ...defaultConfig.providers.gemini, enabled: true }
      }
    });

    await expect(
      registry.get("anthropic")?.chat({
        model: "claude-opus-4.1",
        messages: [{ role: "user", content: "hello" }]
      })
    ).rejects.toThrow("placeholder");
    await expect(
      registry.get("gemini")?.chat({
        model: "gemini-2.5-pro",
        messages: [{ role: "user", content: "hello" }]
      })
    ).rejects.toThrow("placeholder");
  });
});
