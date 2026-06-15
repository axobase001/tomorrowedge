import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import type { TomorrowEdgeConfig } from "../../src/config/schema.js";
import { createEventLedger } from "../../src/core/events/eventLedger.js";
import { chatWithProviderFallback } from "../../src/core/model/providerFallback.js";
import { ModelRouter } from "../../src/core/routing/router.js";

describe("provider fallback", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("redacts provider account identifiers from fallback errors and events", async () => {
    const { server, url } = await startErrorServer();
    servers.push(server);
    const config: TomorrowEdgeConfig = {
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        openai_compatible: {
          ...defaultConfig.providers.openai_compatible,
          enabled: true,
          api_key_env: "",
          base_url: url,
          model: "free-test-model",
          auth_header: "none"
        }
      }
    };
    const ledger = createEventLedger("partial", "session_provider_fallback_test");

    const result = await chatWithProviderFallback({
      config,
      router: new ModelRouter(config),
      role: "planner",
      provider: "openai_compatible",
      model: "free-test-model",
      ledger,
      buildRequest: (model) => ({
        model,
        messages: [{ role: "user", content: "smoke" }],
        maxCompletionTokens: 16
      })
    });
    const serialized = JSON.stringify({ result, events: ledger.events });

    expect(result.fallbackUsed).toBe(true);
    expect(serialized).not.toContain("user_3EfqcfPXAjQTwahh8KSxAxJJYP9");
    expect(serialized).not.toContain("acct_live_123");
    expect(serialized).toContain("[redacted]");
    expect(serialized).toContain("rate_limited");
    expect(serialized).toContain("provider_fallback");
  }, 10_000);

  it("skips repeated live calls after a rate limit in the same ledger", async () => {
    const errorServer = await startErrorServer();
    servers.push(errorServer.server);
    const config: TomorrowEdgeConfig = {
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        openai_compatible: {
          ...defaultConfig.providers.openai_compatible,
          enabled: true,
          api_key_env: "",
          base_url: errorServer.url,
          model: "free-test-model",
          auth_header: "none"
        }
      }
    };
    const ledger = createEventLedger("partial", "session_provider_skip_test");
    const input = {
      config,
      router: new ModelRouter(config),
      role: "planner" as const,
      provider: "openai_compatible",
      model: "free-test-model",
      ledger,
      buildRequest: (model: string) => ({
        model,
        messages: [{ role: "user" as const, content: "smoke" }],
        maxCompletionTokens: 16
      })
    };

    await chatWithProviderFallback(input);
    const afterFirstCall = errorServer.requests();
    await chatWithProviderFallback(input);

    expect(afterFirstCall).toBeGreaterThan(0);
    expect(errorServer.requests()).toBe(afterFirstCall);
    expect(JSON.stringify(ledger.events)).toContain("skipped openai_compatible/free-test-model");
  }, 10_000);

  it("can block mock or fixture fallback for live provider execution", async () => {
    const errorServer = await startErrorServer();
    servers.push(errorServer.server);
    const config: TomorrowEdgeConfig = {
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        openai_compatible: {
          ...defaultConfig.providers.openai_compatible,
          enabled: true,
          api_key_env: "",
          base_url: errorServer.url,
          model: "free-test-model",
          auth_header: "none"
        }
      }
    };
    const ledger = createEventLedger("partial", "session_provider_synthetic_skip_test");

    const result = await chatWithProviderFallback({
      config,
      router: new ModelRouter(config),
      role: "coder_a",
      provider: "openai_compatible",
      model: "free-test-model",
      ledger,
      allowSyntheticFallback: false,
      buildRequest: (model) => ({
        model,
        messages: [{ role: "user", content: "produce a patch" }],
        maxCompletionTokens: 16
      })
    });
    const serialized = JSON.stringify({ result, events: ledger.events });

    expect(result.response).toBeUndefined();
    expect(result.fallbackUsed).toBeUndefined();
    expect(serialized).toContain("Synthetic fallback mock/mock-balanced was skipped");
    expect(serialized).toContain("\"skipped\":true");
  }, 10_000);
});

async function startErrorServer(): Promise<{ server: Server; url: string; requests: () => number }> {
  let requestCount = 0;
  const server = createServer((_request, response) => {
    requestCount += 1;
    response.writeHead(429, { "content-type": "application/json" });
    response.end(JSON.stringify({
      error: {
        message: "temporarily rate-limited upstream",
        metadata: { provider_name: "Crucible" }
      },
      user_id: "user_3EfqcfPXAjQTwahh8KSxAxJJYP9",
      accountId: "acct_live_123"
    }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("test server did not bind to a port");
  return { server, url: `http://127.0.0.1:${address.port}`, requests: () => requestCount };
}
