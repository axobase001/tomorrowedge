import { buildStrategyMemoryHints, readLearnedTaskMemory } from "../../core/memory/taskMemory.js";

export async function memoryCommand(cwd: string, options: { limit?: string; strategy?: boolean } = {}): Promise<void> {
  const limit = options.limit ? Number(options.limit) : 20;
  if (options.strategy) {
    const hints = await buildStrategyMemoryHints(cwd, { limit: Number.isFinite(limit) ? limit : 20 });
    process.stdout.write(`strategy memory records=${hints.sourceRecords}\n`);
    if (hints.preferredTestCommand) process.stdout.write(`test_command=${hints.preferredTestCommand}\n`);
    for (const route of hints.routeAssignments) {
      process.stdout.write(`${route.role}\t${route.provider}/${route.model}\t${route.reason}\n`);
    }
    if (!hints.routeAssignments.length && !hints.preferredTestCommand) process.stdout.write("No strategy hints available.\n");
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
        record.visualPageType ? `visual=${record.visualPageType}` : undefined,
        `judge=${record.judgeDecision ?? "unknown"}`,
        `result=${record.result ?? "unknown"}`,
        `goal=${record.goalFingerprint}`
      ].filter(Boolean).join("\t") + "\n"
    );
  }
}
