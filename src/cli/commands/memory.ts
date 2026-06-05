import { readLearnedTaskMemory } from "../../core/memory/taskMemory.js";
import { loadConfig } from "../../config/configLoader.js";
import { buildStrategyMemoryRouting } from "../../core/memory/strategyMemory.js";

export async function memoryCommand(cwd: string, options: { limit?: string; strategy?: string } = {}): Promise<void> {
  const limit = options.limit ? Number(options.limit) : 20;
  if (options.strategy) {
    const config = loadConfig(cwd);
    const summary = await buildStrategyMemoryRouting(cwd, options.strategy, {
      ...config,
      memory: { ...config.memory, history_limit: Number.isFinite(limit) ? limit : config.memory.history_limit }
    });
    process.stdout.write(`Strategy memory preview (${summary.taskType})\n`);
    process.stdout.write(`enabled: ${summary.enabled}\n`);
    process.stdout.write(`records: ${summary.recordsConsidered}\n`);
    for (const route of summary.routes) {
      process.stdout.write(`route ${route.role}: ${route.provider}/${route.model} (${route.reason})\n`);
    }
    for (const item of summary.avoid) {
      process.stdout.write(`avoid ${item.role}: ${item.provider}/${item.model} (${item.errorCategory})\n`);
    }
    if (summary.preferredTestCommands.length) {
      process.stdout.write(`test: ${summary.preferredTestCommands.join(" | ")}\n`);
    }
    if (!summary.routes.length && !summary.avoid.length && !summary.preferredTestCommands.length) {
      process.stdout.write("No strategy suggestions found.\n");
    }
    return;
  }
  const records = await readLearnedTaskMemory(cwd, Number.isFinite(limit) ? limit : 20);
  if (!records.length) {
    process.stdout.write("No learned task memory found.\n");
    return;
  }
  for (const record of records) {
    process.stdout.write(
      [
        record.createdAt,
        record.taskType,
        `risk=${record.riskLevel}`,
        `route=${record.routingMode}`,
        record.providerOutcomes?.length ? `providers=${record.providerOutcomes.length}` : undefined,
        record.visualPageType ? `visual=${record.visualPageType}` : undefined,
        `judge=${record.judgeDecision ?? "unknown"}`,
        `result=${record.result ?? "unknown"}`,
        `goal=${record.goalFingerprint}`
      ].filter(Boolean).join("\t") + "\n"
    );
  }
}
