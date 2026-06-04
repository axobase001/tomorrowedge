import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { createProviderRegistry } from "../../src/providers/registry.js";
import { OpenAICompatibleProvider } from "../../src/providers/openaiCompatible.js";
import { recommendFreeOpenRouterModels } from "../../src/providers/openrouterCatalog.js";
import { testProviderConnection } from "../../src/providers/connectionTest.js";

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

  it("reads OLLAMA_BASE_URL after local env loading instead of defaultConfig module import", () => {
    vi.stubEnv("OLLAMA_BASE_URL", "http://localhost:18080");
    const registry = createProviderRegistry(defaultConfig);
    expect(registry.get("ollama")).toBeTruthy();
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

  it("recommends free Kimi 2.6 from an OpenRouter catalog ahead of generic free models", () => {
    const recommended = recommendFreeOpenRouterModels(
      [
        {
          id: "qwen/qwen3-coder:free",
          name: "Qwen Coder Free",
          contextWindow: 131072,
          promptPrice: 0,
          completionPrice: 0,
          isFree: true,
          isLowCost: false,
          tags: ["qwen", "long-context"]
        },
        {
          id: "moonshotai/kimi-k2.6:free",
          name: "MoonshotAI: Kimi K2.6 (free)",
          contextWindow: 262144,
          promptPrice: 0,
          completionPrice: 0,
          isFree: true,
          isLowCost: false,
          tags: ["kimi", "k2.6", "long-context"]
        }
      ],
      { limit: 2 }
    );

    expect(recommended[0]?.id).toBe("moonshotai/kimi-k2.6:free");
  });

  it("tests provider connectivity with a lightweight /models request", async () => {
    vi.stubEnv("OPENROUTER_TEST_KEY", "test-key");
    let observedUrl = "";
    let observedHeaders: Headers | undefined;
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      observedUrl = String(input);
      observedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const result = await testProviderConnection("openrouter", {
      enabled: true,
      api_key_env: "OPENROUTER_TEST_KEY",
      base_url: "https://openrouter.ai/api/v1",
      model: "moonshotai/kimi-k2.6:free",
      api_format: "openai_chat",
      auth_header: "bearer",
      extra_headers: {}
    });

    expect(observedUrl).toBe("https://openrouter.ai/api/v1/models");
    expect(observedHeaders?.get("Authorization")).toBe("Bearer test-key");
    expect(result.status).toBe("ok");
    expect(result.httpStatus).toBe(200);
  });

  it("does not attempt provider connectivity when the configured key env is missing", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return new Response("should not call", { status: 500 });
    });

    const result = await testProviderConnection("openrouter", {
      enabled: true,
      api_key_env: "OPENROUTER_MISSING_TEST_KEY",
      base_url: "https://openrouter.ai/api/v1",
      model: "moonshotai/kimi-k2.6:free",
      api_format: "openai_chat",
      auth_header: "bearer",
      extra_headers: {}
    });

    expect(calls).toBe(0);
    expect(result.status).toBe("failed");
    expect(result.detail).toContain("missing env");
  });
});
