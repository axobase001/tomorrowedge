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

  it("registers Anthropic and Gemini native adapters", async () => {
    vi.stubEnv("ANTHROPIC_TEST_KEY", "anthropic-test-key");
    vi.stubEnv("GEMINI_TEST_KEY", "gemini-test-key");
    const registry = createProviderRegistry({
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        anthropic: { ...defaultConfig.providers.anthropic, enabled: true, api_key_env: "ANTHROPIC_TEST_KEY" },
        gemini: { ...defaultConfig.providers.gemini, enabled: true, api_key_env: "GEMINI_TEST_KEY" }
      }
    });

    expect(await registry.get("anthropic")?.listModels()).toMatchObject([{ id: "claude-sonnet-4-5" }]);
    expect(await registry.get("gemini")?.listModels()).toMatchObject([{ id: "gemini-2.5-pro" }]);
  });

  it("calls Anthropic Messages API with native headers and payload", async () => {
    let observedUrl = "";
    let observedHeaders: Headers | undefined;
    let observedBody: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      observedUrl = String(input);
      observedHeaders = new Headers(init?.headers);
      observedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: "msg_test", model: "claude-sonnet-4-5", content: [{ type: "text", text: "done" }], usage: { input_tokens: 11, output_tokens: 3 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    vi.stubEnv("ANTHROPIC_TEST_KEY", "anthropic-test-key");
    const provider = createProviderRegistry({
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        anthropic: { ...defaultConfig.providers.anthropic, enabled: true, api_key_env: "ANTHROPIC_TEST_KEY" }
      }
    }).get("anthropic")!;

    const response = await provider.chat({
      model: "claude-sonnet-4-5",
      messages: [
        { role: "system", content: "be concise" },
        { role: "user", content: "hello" }
      ],
      maxCompletionTokens: 64
    });

    expect(observedUrl).toBe("https://api.anthropic.com/v1/messages");
    expect(observedHeaders?.get("x-api-key")).toBe("anthropic-test-key");
    expect(observedHeaders?.get("anthropic-version")).toBe("2023-06-01");
    expect(observedBody?.max_tokens).toBe(64);
    expect(observedBody?.system).toBe("be concise");
    expect(response.content).toBe("done");
    expect(response.usage).toEqual({ inputTokens: 11, outputTokens: 3 });
  });

  it("calls Gemini generateContent with native API-key header and payload", async () => {
    let observedUrl = "";
    let observedHeaders: Headers | undefined;
    let observedBody: { contents?: Array<{ role: string; parts: unknown[] }> } | undefined;
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      observedUrl = String(input);
      observedHeaders = new Headers(init?.headers);
      observedBody = JSON.parse(String(init?.body)) as { contents?: Array<{ role: string; parts: unknown[] }> };
      return new Response(JSON.stringify({ responseId: "gemini_test", modelVersion: "gemini-2.5-pro", candidates: [{ content: { parts: [{ text: "done" }] } }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    vi.stubEnv("GEMINI_TEST_KEY", "gemini-test-key");
    const provider = createProviderRegistry({
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        gemini: { ...defaultConfig.providers.gemini, enabled: true, api_key_env: "GEMINI_TEST_KEY" }
      }
    }).get("gemini")!;

    const response = await provider.chat({
      model: "gemini-2.5-pro",
      messages: [
        { role: "system", content: "be concise" },
        { role: "user", content: "hello" }
      ],
      maxCompletionTokens: 64
    });

    expect(observedUrl).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent");
    expect(observedHeaders?.get("x-goog-api-key")).toBe("gemini-test-key");
    expect(observedBody?.contents?.[0]?.parts).toEqual([{ text: "System instructions:\nbe concise" }]);
    expect(response.content).toBe("done");
    expect(response.usage).toEqual({ inputTokens: 7, outputTokens: 2 });
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

  it("tests Anthropic and Gemini connectivity with native catalog headers", async () => {
    vi.stubEnv("ANTHROPIC_TEST_KEY", "anthropic-test-key");
    vi.stubEnv("GEMINI_TEST_KEY", "gemini-test-key");
    const observed: Array<{ url: string; headers: Headers }> = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      observed.push({ url: String(input), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const anthropic = await testProviderConnection("anthropic", {
      enabled: true,
      api_key_env: "ANTHROPIC_TEST_KEY",
      base_url: "https://api.anthropic.com/v1",
      model: "claude-sonnet-4-5",
      api_format: "legacy_chat",
      auth_header: "api-key",
      extra_headers: {}
    });
    const gemini = await testProviderConnection("gemini", {
      enabled: true,
      api_key_env: "GEMINI_TEST_KEY",
      base_url: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-2.5-pro",
      api_format: "openai_chat",
      auth_header: "api-key",
      extra_headers: {}
    });

    expect(anthropic.status).toBe("ok");
    expect(gemini.status).toBe("ok");
    expect(observed[0]?.url).toBe("https://api.anthropic.com/v1/models");
    expect(observed[0]?.headers.get("x-api-key")).toBe("anthropic-test-key");
    expect(observed[0]?.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(observed[1]?.url).toBe("https://generativelanguage.googleapis.com/v1beta/models");
    expect(observed[1]?.headers.get("x-goog-api-key")).toBe("gemini-test-key");
  });
});
