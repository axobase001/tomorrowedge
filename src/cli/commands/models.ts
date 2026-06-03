import { loadConfig } from "../../config/configLoader.js";
import { createProviderRegistry } from "../../providers/registry.js";

export type ModelsOptions = {
  realSmoke?: boolean;
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
          const status = content ? "ok" : "warning: empty response";
          process.stdout.write(`    smoke: ${status} (${response.usage ? `${response.usage.inputTokens}/${response.usage.outputTokens} tokens` : "usage unavailable"})\n`);
        } catch (error) {
          process.stdout.write(`    smoke: failed (${error instanceof Error ? error.message : String(error)})\n`);
        }
      }
    }
  }
}
