import { loadConfig } from "../../config/configLoader.js";
import { createProviderRegistry } from "../../providers/registry.js";

export type ModelsOptions = {
  realSmoke?: boolean;
  smokeSuite?: boolean;
};

export async function modelsCommand(cwd: string, options: ModelsOptions = {}): Promise<void> {
  const config = loadConfig(cwd);
  const registry = createProviderRegistry(config);
  for (const provider of registry.list()) {
    const models = await provider.listModels();
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
          process.stdout.write(`    smoke: failed (${error instanceof Error ? error.message : String(error)})\n`);
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
    return { name: "smoke:text", status: "failed", detail: error instanceof Error ? error.message : String(error) };
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
    return { name: "smoke:json", status: "failed", detail: error instanceof Error ? error.message : String(error) };
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
    return { name: "smoke:vision", status: "failed", detail: error instanceof Error ? error.message : String(error) };
  }
}

function tokenDetail(usage?: { inputTokens: number; outputTokens: number }): string {
  return usage ? `${usage.inputTokens}/${usage.outputTokens} tokens` : "usage unavailable";
}

function isExactOk(content: string): boolean {
  return content.trim().toLowerCase() === "ok";
}

function onePixelPngDataUrl(): string {
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
}
