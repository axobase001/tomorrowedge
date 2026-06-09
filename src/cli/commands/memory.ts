import {
  buildStrategyMemoryHints,
  compactFailureMemories,
  deleteFailureMemory,
  explainFailureMemories,
  previewLearnedTaskMemory,
  readFailureMemories,
  readLearnedTaskMemory,
  showFailureMemory,
  type FailureMemoryExplanation,
  type FailureMemoryRecord
} from "../../core/memory/taskMemory.js";
import { loadLatestSession, loadSession } from "../../core/memory/sessionMemory.js";
import { writeFile } from "node:fs/promises";
import { loadConfig } from "../../config/configLoader.js";

type MemoryOptions = { limit?: string; strategy?: boolean; json?: boolean };
type FailureMemoryOptions = { limit?: string; json?: boolean; includeStale?: boolean };

export async function memoryCommand(cwd: string, options: MemoryOptions = {}): Promise<void> {
  const limit = options.limit ? Number(options.limit) : 20;
  if (options.strategy) {
    const hints = await buildStrategyMemoryHints(cwd, { limit: Number.isFinite(limit) ? limit : 20 });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(hints, null, 2)}\n`);
      return;
    }
    process.stdout.write(`strategy memory records=${hints.sourceRecords}\n`);
    if (hints.preferredTestCommand) process.stdout.write(`test_command=${hints.preferredTestCommand}\n`);
    for (const route of hints.routeAssignments) {
      process.stdout.write(`${route.role}\t${route.provider}/${route.model}\t${route.reason}\n`);
    }
    if (!hints.routeAssignments.length && !hints.preferredTestCommand) process.stdout.write("No strategy hints available.\n");
    return;
  }
  const records = await readLearnedTaskMemory(cwd, Number.isFinite(limit) ? limit : 20);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);
    return;
  }
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

export async function memoryFailuresCommand(cwd: string, options: FailureMemoryOptions = {}): Promise<void> {
  const limit = options.limit ? Number(options.limit) : 20;
  const records = await readFailureMemories(cwd, Number.isFinite(limit) ? limit : 20, { includeStale: options.includeStale });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);
    return;
  }
  if (!records.length) {
    process.stdout.write("No failure memory found.\n");
    return;
  }
  process.stdout.write("id\tcreatedAt\tclass\tconfidence\toccurrences\tfixed\tstale\ttask\tevidence\tcorrection\n");
  for (const record of records) {
    process.stdout.write(renderFailureRow(record));
  }
}

export async function memoryShowCommand(cwd: string, id: string, options: { json?: boolean; includeStale?: boolean } = {}): Promise<void> {
  const record = await showFailureMemory(cwd, id, { includeStale: options.includeStale });
  if (!record) {
    process.stderr.write(`Failure memory not found: ${id}\n`);
    process.exitCode = 1;
    return;
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    return;
  }
  process.stdout.write(renderFailureDetail(record));
}

export async function memoryExplainCommand(cwd: string, task: string, options: { limit?: string; json?: boolean } = {}): Promise<void> {
  const limit = options.limit ? Number(options.limit) : 5;
  const explanation = await explainFailureMemories(cwd, task, { limit: Number.isFinite(limit) ? limit : 5 });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(explanation, null, 2)}\n`);
    return;
  }
  process.stdout.write(renderExplanation(explanation));
}

export async function memoryPreviewCommand(cwd: string, sessionId: string, options: { json?: boolean } = {}): Promise<void> {
  const session = sessionId === "latest" ? await loadLatestSession(cwd) : await loadSession(cwd, sessionId);
  const config = loadConfig(cwd);
  const preview = await previewLearnedTaskMemory(cwd, session.state, { failureMemory: config.failure_memory });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
    return;
  }
  process.stdout.write(renderPreview(preview));
}

export async function memoryExportCommand(cwd: string, options: { output?: string; includeStale?: boolean } = {}): Promise<void> {
  const records = await readFailureMemories(cwd, 10_000, { includeStale: options.includeStale });
  const json = `${JSON.stringify(records, null, 2)}\n`;
  if (options.output) {
    await writeFile(options.output, json, "utf8");
    process.stdout.write(`Exported ${records.length} failure memory record(s) to ${options.output}\n`);
    return;
  }
  process.stdout.write(json);
}

export async function memoryDeleteCommand(cwd: string, id: string): Promise<void> {
  const deleted = await deleteFailureMemory(cwd, id);
  if (!deleted) {
    process.stderr.write(`Failure memory not found: ${id}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Deleted failure memory: ${id}\n`);
}

export async function memoryCompactCommand(cwd: string, options: { keepStale?: boolean; limit?: string; json?: boolean } = {}): Promise<void> {
  const limit = options.limit ? Number(options.limit) : undefined;
  const result = await compactFailureMemories(cwd, { keepStale: options.keepStale, limit: Number.isFinite(limit) ? limit : undefined });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`Compacted failure memory: before=${result.before} after=${result.after} removed=${result.removed}\n`);
}

function renderFailureRow(record: FailureMemoryRecord): string {
  return [
    record.id,
    record.createdAt,
    record.failureClass,
    record.confidence.toFixed(2),
    record.recurrenceCount,
    record.fixedCount,
    record.stale ? record.staleReason ?? "stale" : "-",
    record.goalPreview ?? record.goalFingerprint,
    record.evidenceRefs.length ? record.evidenceRefs.length : "-",
    record.correction
  ].join("\t") + "\n";
}

function renderFailureDetail(record: FailureMemoryRecord): string {
  return [
    `id: ${record.id}`,
    `createdAt: ${record.createdAt}`,
    `task: ${record.goalPreview ?? record.goalFingerprint}`,
    `taskType: ${record.taskType}`,
    `risk: ${record.riskLevel}`,
    `result: ${record.result ?? "unknown"}`,
    `failureClass: ${record.failureClass}`,
    `confidence: ${record.confidence.toFixed(2)}`,
    `recurrence: ${record.recurrence}`,
    `recurrenceCount: ${record.recurrenceCount}`,
    `fixedCount: ${record.fixedCount}`,
    `schemaVersion: ${record.schemaVersion}`,
    `failureSignature: ${record.failureSignature}`,
    `stale: ${record.stale ? record.staleReason ?? "yes" : "no"}`,
    `judge: ${record.judgeDecision ?? "unknown"}`,
    `selectedCandidate: ${record.selectedCandidate ?? "-"}`,
    `verification: ${(record.verificationCommands ?? []).join(", ") || "-"}`,
    `correction: ${record.correction}`,
    `evidenceRefs: ${record.evidenceRefs.length ? record.evidenceRefs.join(", ") : "-"}`
  ].join("\n") + "\n";
}

function renderExplanation(explanation: FailureMemoryExplanation): string {
  const lines = [`task: ${explanation.task}`, `selected=${explanation.selected.length} rejected=${explanation.rejected.length}`];
  for (const record of explanation.selected) {
    lines.push(
      [
        `${record.id}`,
        `score=${record.score}`,
        `class=${record.failureClass}`,
        `signals=${record.matchedSignals.slice(0, 8).join(",") || "-"}`,
        `correction=${record.correction}`
      ].join("\t")
    );
  }
  if (!explanation.selected.length) lines.push("No relevant failure memories selected.");
  return `${lines.join("\n")}\n`;
}

function renderPreview(preview: Awaited<ReturnType<typeof previewLearnedTaskMemory>>): string {
  const record = preview.record;
  return [
    `wouldWrite: ${preview.wouldWrite ? "yes" : "no"}`,
    `reason: ${preview.reason}`,
    `storageScope: ${preview.policy.storageScope}`,
    `redaction: ${preview.policy.redaction}`,
    record ? `task: ${record.goalPreview ?? record.goalFingerprint}` : undefined,
    record?.failureClass ? `failureClass: ${record.failureClass}` : undefined,
    record?.correction ? `correction: ${record.correction}` : undefined,
    `evidenceRefs: ${record?.evidenceRefs?.length ? record.evidenceRefs.join(", ") : "-"}`
  ].filter((line): line is string => Boolean(line)).join("\n") + "\n";
}
