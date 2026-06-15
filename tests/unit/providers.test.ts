import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { createProviderRegistry } from "../../src/providers/registry.js";
import { OpenAICompatibleProvider } from "../../src/providers/openaiCompatible.js";
import { canonicalizeOpenRouterModelId, recommendFreeOpenRouterModels } from "../../src/providers/openrouterCatalog.js";
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

  it("registers custom OpenAI-compatible gateway providers from config", async () => {
    vi.stubEnv("ONEAPI_GATEWAY_KEY", "test-key");
    const registry = createProviderRegistry({
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        oneapi_gateway: {
          enabled: true,
          api_key_env: "ONEAPI_GATEWAY_KEY",
          base_url: "https://oneapi.example/v1",
          model: "gpt-4o-mini",
          api_format: "openai_chat",
          auth_header: "bearer",
          extra_headers: {}
        }
      }
    });

    expect(registry.get("oneapi_gateway")).toBeTruthy();
    await expect(registry.get("oneapi_gateway")?.listModels()).resolves.toMatchObject([{ id: "gpt-4o-mini" }]);
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

  it("suppresses reasoning output for OpenRouter JSON-mode OpenAI-compatible calls", async () => {
    let observedBody: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", async (_input: string | URL | Request, init?: RequestInit) => {
      observedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: "ok", choices: [{ message: { content: "{\"ok\":true}" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const provider = new OpenAICompatibleProvider({
      id: "openrouter",
      name: "OpenRouter",
      apiKey: "test-key",
      baseUrl: "https://openrouter.ai/api/v1",
      defaultModel: "z-ai/glm-5.1"
    });

    await provider.chat({
      model: "z-ai/glm-5.1",
      messages: [{ role: "user", content: "return JSON" }],
      responseFormat: { type: "json_object" }
    });

    expect(observedBody?.response_format).toEqual({ type: "json_object" });
    expect(observedBody?.reasoning).toEqual({ effort: "none", exclude: true });
    expect(observedBody?.reasoning_effort).toBe("none");
  });

  it("passes json_schema structured output formats through OpenAI-compatible providers", async () => {
    let observedBody: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", async (_input: string | URL | Request, init?: RequestInit) => {
      observedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: "ok", choices: [{ message: { content: "{\"ok\":true}" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const provider = new OpenAICompatibleProvider({
      id: "openrouter",
      name: "OpenRouter",
      apiKey: "test-key",
      baseUrl: "https://openrouter.ai/api/v1",
      defaultModel: "z-ai/glm-5.1"
    });

    await provider.chat({
      model: "z-ai/glm-5.1",
      messages: [{ role: "user", content: "return structured JSON" }],
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "test_schema",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: { ok: { type: "boolean" } },
            required: ["ok"]
          }
        }
      }
    });

    expect(observedBody?.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "test_schema", strict: true }
    });
    expect(observedBody?.reasoning).toEqual({ effort: "none", exclude: true });
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

  it("parses OpenAI-compatible SSE data framing", async () => {
    vi.stubGlobal("fetch", async () => new Response([
      "data: {\"id\":\"sse-ok\",\"choices\":[{\"delta\":{\"content\":\"hel\"}}]}",
      "data: {\"id\":\"sse-ok\",\"choices\":[{\"delta\":{\"content\":\"lo\"}}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2}}",
      "data: [DONE]",
      ""
    ].join("\n"), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    }));

    const provider = new OpenAICompatibleProvider({
      id: "openai_compatible",
      name: "OpenAI-compatible",
      apiKey: "test-key",
      baseUrl: "https://relay.example/v1",
      defaultModel: "gpt-5.5"
    });

    const response = await provider.chat({
      model: "gpt-5.5",
      messages: [{ role: "user", content: "hello" }]
    });

    expect(response).toMatchObject({
      id: "sse-ok",
      content: "hello",
      usage: { inputTokens: 3, outputTokens: 2 }
    });
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

  it("canonicalizes OpenRouter display labels and stale Kimi defaults before provider calls", () => {
    const catalog = [{
      id: "moonshotai/kimi-k2.6:free",
      name: "MoonshotAI: Kimi K2.6 (free)",
      contextWindow: 262144,
      promptPrice: 0,
      completionPrice: 0,
      isFree: true,
      isLowCost: false,
      tags: ["kimi", "k2.6"]
    }];

    expect(canonicalizeOpenRouterModelId("MoonshotAI: Kimi K2.6 (free)", catalog)).toBe("moonshotai/kimi-k2.6:free");
    expect(canonicalizeOpenRouterModelId("moonshotai/kimi-k2:free", catalog)).toBe("moonshotai/kimi-k2.6:free");
    expect(canonicalizeOpenRouterModelId("MoonshotAI: Kimi K2.6 (free)")).toBe("moonshotai/kimi-k2.6:free");
  });

  it("tests provider connectivity with a selected-model smoke request", async () => {
    vi.stubEnv("OPENROUTER_TEST_KEY", "test-key");
    let observedUrl = "";
    let observedHeaders: Headers | undefined;
    let observedBody = "";
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      observedUrl = String(input);
      observedHeaders = new Headers(init?.headers);
      observedBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
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

    expect(observedUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(observedHeaders?.get("Authorization")).toBe("Bearer test-key");
    expect(observedBody).toContain("moonshotai/kimi-k2.6:free");
    expect(result.status).toBe("ok");
    expect(result.httpStatus).toBe(200);
    expect(result.testedModel).toBe("moonshotai/kimi-k2.6:free");
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
    expect(result.status).toBe("missing_key");
    expect(result.reason).toBe("missing_key");
    expect(result.apiKeyEnv).toBe("OPENROUTER_MISSING_TEST_KEY");
    expect(result.detail).toContain("missing env");
  });

  it("classifies invalid authentication responses for user-facing guidance", async () => {
    vi.stubEnv("OPENROUTER_TEST_KEY", "test-key");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({
      error: { message: "Invalid Authentication", type: "invalid_authentication_error" }
    }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    }));

    const result = await testProviderConnection("openrouter", {
      enabled: true,
      api_key_env: "OPENROUTER_TEST_KEY",
      base_url: "https://openrouter.ai/api/v1",
      model: "moonshotai/kimi-k2.6:free",
      api_format: "openai_chat",
      auth_header: "bearer",
      extra_headers: {}
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("invalid_authentication");
    expect(result.httpStatus).toBe(401);
    expect(result.rawDetail).toContain("Invalid Authentication");
  });

  it("classifies invalid model responses for user-facing guidance", async () => {
    vi.stubEnv("OPENAI_TEST_KEY", "test-key");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({
      error: { message: "invalid model ID" }
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    }));

    const result = await testProviderConnection("openai_compatible", {
      enabled: true,
      api_key_env: "OPENAI_TEST_KEY",
      base_url: "https://api.openai.com/v1",
      model: "bad-model-id",
      api_format: "openai_chat",
      auth_header: "bearer",
      extra_headers: {}
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("invalid_model");
    expect(result.testedModel).toBe("bad-model-id");
    expect(result.rawDetail).toContain("invalid model ID");
  });

  it("tests Anthropic and Gemini connectivity with native selected-model smoke endpoints", async () => {
    vi.stubEnv("ANTHROPIC_TEST_KEY", "anthropic-test-key");
    vi.stubEnv("GEMINI_TEST_KEY", "gemini-test-key");
    const observed: Array<{ url: string; headers: Headers }> = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      observed.push({ url: String(input), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify({ ok: true }), {
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
    expect(observed[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(observed[0]?.headers.get("x-api-key")).toBe("anthropic-test-key");
    expect(observed[0]?.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(observed[1]?.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent");
    expect(observed[1]?.headers.get("x-goog-api-key")).toBe("gemini-test-key");
  });
});
