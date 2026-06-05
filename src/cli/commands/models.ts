import { loadConfig, writeConfig } from "../../config/configLoader.js";
import { createProviderRegistry } from "../../providers/registry.js";
import { testProviderConnections } from "../../providers/connectionTest.js";
import { fetchOpenRouterCatalog, formatOpenRouterModelLine, recommendFreeOpenRouterModels } from "../../providers/openrouterCatalog.js";
import { formatProviderError, redactProviderError } from "../../safety/providerRedaction.js";

export type ModelsOptions = {
  realSmoke?: boolean;
  smokeSuite?: boolean;
  refreshFree?: boolean;
  configureFree?: string;
  freeFirst?: boolean;
  limit?: string;
  provider?: string;
  connectionTest?: boolean;
};

export async function modelsCommand(cwd: string, options: ModelsOptions = {}): Promise<void> {
  let config = loadConfig(cwd);
  if (options.connectionTest) {
    await runConnectionTests(config, options.provider);
    if (!options.refreshFree && !options.configureFree && !options.realSmoke && !options.smokeSuite) return;
  }
  if (options.refreshFree || options.configureFree) {
    await refreshFreeModels(cwd, config, options);
    if (!options.realSmoke && !options.smokeSuite) return;
    config = loadConfig(cwd);
  }
  const registry = createProviderRegistry(config);
  for (const provider of registry.list()) {
    let models: Awaited<ReturnType<typeof provider.listModels>>;
    try {
      models = await provider.listModels();
    } catch (error) {
      process.stdout.write(`${provider.id} [${provider.kind}]\n`);
      process.stdout.write(`  error: ${errorMessage(error)}\n`);
      continue;
    }
    process.stdout.write(`${provider.id} [${provider.kind}]\n`);
    if (!models.length) {
      process.stdout.write("  no configured models or provider unavailable\n");
      continue;
    }
    for (const model of models) {
      process.stdout.write(`  ${model.id} ${model.contextWindow ? `(${model.contextWindow})` : ""}\n`);
      if (options.realSmoke && provider.kind === "cloud") {
        try {
          const response = await provider.chat({
            model: model.id,
            messages: [{ role: "user", content: "Reply with exactly: ok" }],
            temperature: 0,
            maxCompletionTokens: 64
          });
          const content = response.content.trim();
          const status = isExactOk(content) ? "ok" : content ? "warning: expected exact ok" : "warning: empty response";
          process.stdout.write(`    smoke: ${status} (${response.usage ? `${response.usage.inputTokens}/${response.usage.outputTokens} tokens` : "usage unavailable"})\n`);
        } catch (error) {
          process.stdout.write(`    smoke: failed (${errorMessage(error)})\n`);
        }
      }
      if (options.smokeSuite && provider.kind === "cloud") {
        const checks = await runSmokeSuite(provider, model.id);
        for (const check of checks) {
          process.stdout.write(`    ${check.name}: ${check.status}${check.detail ? ` (${check.detail})` : ""}\n`);
        }
      }
    }
  }
}

async function runConnectionTests(config: ReturnType<typeof loadConfig>, providerFilter?: string): Promise<void> {
  const results = await testProviderConnections(config, providerFilter);
  process.stdout.write("Provider connection test\n");
  for (const result of results) {
    const status = result.httpStatus ? `HTTP ${result.httpStatus}` : result.status;
    const url = result.url ? ` ${result.url}` : "";
    process.stdout.write(`  ${result.id}: ${result.status} (${status})${url}\n`);
    process.stdout.write(`    ${result.detail}\n`);
  }
}

async function refreshFreeModels(cwd: string, config: ReturnType<typeof loadConfig>, options: ModelsOptions): Promise<void> {
  const providerId = options.provider ?? config.model_discovery.recommended_provider;
  if (providerId !== "openrouter") {
    throw new Error(`Free model refresh currently supports openrouter. Requested: ${providerId}`);
  }
  const provider = config.providers.openrouter;
  if (!provider) throw new Error("OpenRouter provider is missing from config.");
  const apiKey = provider.api_key_env ? process.env[provider.api_key_env] : undefined;
  const limit = parseLimit(options.limit, config.model_discovery.free_model_limit);
  const catalog = await fetchOpenRouterCatalog(provider, apiKey);
  const recommendations = recommendFreeOpenRouterModels(catalog, { limit, preferKimi: true });
  process.stdout.write("OpenRouter free / low-cost recommendations\n");
  process.stdout.write("Recommended provider: OpenRouter (one key, many model families; replace later per role as needed)\n");
  process.stdout.write("Key hygiene: use separate provider keys where possible for cost tracking, rate-limit isolation, and fault diagnosis.\n");
  if (!recommendations.length) {
    process.stdout.write("No free or low-cost candidates were found in the live catalog.\n");
    return;
  }
  for (const model of recommendations) {
    process.stdout.write(`  ${formatOpenRouterModelLine(model)}\n`);
  }
  if (!options.configureFree) {
    process.stdout.write("\nChoose one with: tedge models --configure-free <model-id>\n");
    return;
  }
  const selected = catalog.find((model) => model.id === options.configureFree);
  if (!selected) {
    throw new Error(`Model not found in OpenRouter catalog: ${options.configureFree}`);
  }
  if (!selected.isFree && !selected.isLowCost) {
    throw new Error(`Refusing to configure a non-free/non-low-cost onboarding model: ${selected.id}`);
  }
  const next = {
    ...config,
    routing: { ...config.routing, mode: options.freeFirst ? "cheap" as const : config.routing.mode },
    providers: {
      ...config.providers,
      openrouter: {
        ...provider,
        enabled: true,
        model: selected.id,
        api_key_env: provider.api_key_env ?? "OPENROUTER_API_KEY",
        base_url: provider.base_url || "https://openrouter.ai/api/v1"
      }
    },
    agents: options.freeFirst
      ? {
          ...config.agents,
          explorer: { provider: "openrouter", model: selected.id },
          coder_b: { provider: "openrouter", model: selected.id },
          summarizer: { provider: "openrouter", model: selected.id }
        }
      : config.agents
  };
  await writeConfig(cwd, next);
  process.stdout.write(`\nConfigured OpenRouter onboarding model: ${selected.id}\n`);
  process.stdout.write("API key remains outside config. Set OPENROUTER_API_KEY in your environment or local .env.\n");
  if (options.freeFirst) process.stdout.write("Free-first routing bound explorer/coder_b/summarizer to the selected OpenRouter model.\n");
}

function parseLimit(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) throw new Error("--limit must be an integer from 1 to 50.");
  return parsed;
}

type SmokeCheck = {
  name: string;
  status: "ok" | "warning" | "failed" | "skipped";
  detail?: string;
};

async function runSmokeSuite(provider: ReturnType<typeof createProviderRegistry>["list"] extends () => Array<infer P> ? P : never, model: string): Promise<SmokeCheck[]> {
  const checks: SmokeCheck[] = [];
  checks.push(await smokeText(provider, model));
  checks.push(await smokeJson(provider, model));
  checks.push(await smokeVision(provider, model));
  return checks;
}

async function smokeText(provider: Parameters<typeof runSmokeSuite>[0], model: string): Promise<SmokeCheck> {
  try {
    const response = await provider.chat({
      model,
      messages: [{ role: "user", content: "Reply with exactly: ok" }],
      temperature: 0,
      maxCompletionTokens: 64
    });
    const content = response.content.trim();
    if (isExactOk(content)) return { name: "smoke:text", status: "ok", detail: tokenDetail(response.usage) };
    return { name: "smoke:text", status: "warning", detail: content ? "expected exact ok" : "empty response" };
  } catch (error) {
    return { name: "smoke:text", status: "failed", detail: errorMessage(error) };
  }
}

async function smokeJson(provider: Parameters<typeof runSmokeSuite>[0], model: string): Promise<SmokeCheck> {
  try {
    const response = await provider.chat({
      model,
      messages: [{ role: "user", content: "Return only JSON: {\"ok\":true}" }],
      temperature: 0,
      maxCompletionTokens: 128
    });
    const text = response.content.trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const parsed = start >= 0 && end >= start ? JSON.parse(text.slice(start, end + 1)) : undefined;
    return parsed?.ok === true ? { name: "smoke:json", status: "ok", detail: tokenDetail(response.usage) } : { name: "smoke:json", status: "warning", detail: "JSON shape mismatch" };
  } catch (error) {
    return { name: "smoke:json", status: "failed", detail: errorMessage(error) };
  }
}

async function smokeVision(provider: Parameters<typeof runSmokeSuite>[0], model: string): Promise<SmokeCheck> {
  if (!["mimo", "openrouter", "openai_compatible", "gemini"].includes(provider.id)) {
    return { name: "smoke:vision", status: "skipped", detail: "provider is not tagged as likely multimodal" };
  }
  try {
    const response = await provider.chat({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "This is a 1x1 transparent PNG. Reply with JSON {\"image\":true}." },
            { type: "image_url", image_url: { url: onePixelPngDataUrl(), detail: "low" } }
          ]
        }
      ],
      temperature: 0,
      maxCompletionTokens: 128
    });
    const text = response.content.trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const parsed = start >= 0 && end >= start ? JSON.parse(text.slice(start, end + 1)) : undefined;
    return parsed?.image === true ? { name: "smoke:vision", status: "ok", detail: tokenDetail(response.usage) } : { name: "smoke:vision", status: "warning", detail: "vision JSON shape mismatch" };
  } catch (error) {
    return { name: "smoke:vision", status: "failed", detail: errorMessage(error) };
  }
}

function errorMessage(error: unknown): string {
  return formatProviderError(redactProviderError(error));
}

function tokenDetail(usage?: { inputTokens: number; outputTokens: number }): string {
  return usage ? `${usage.inputTokens}/${usage.outputTokens} tokens` : "usage unavailable";
}

function isExactOk(content: string): boolean {
  return content.trim().toLowerCase() === "ok";
}

function onePixelPngDataUrl(): string {
  const chunks = [
    "iVBORw0KGgoAAAANS",
    "UhEUgAAAAEAAAAB",
    "CAQAAAC1HAwCAA",
    "AAC0lEQVR42mP8",
    "/x8AAwMCAO+/p9s",
    "AAAAASUVORK5CYII="
  ];
  return `data:image/png;base64,${chunks.join("")}`;
}
