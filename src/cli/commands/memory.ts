import { readLearnedTaskMemory } from "../../core/memory/taskMemory.js";

export async function memoryCommand(cwd: string, options: { limit?: string } = {}): Promise<void> {
  const limit = options.limit ? Number(options.limit) : 20;
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
