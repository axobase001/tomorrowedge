import { existsSync } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { accessModeSchema, type AccessMode } from "../../config/schema.js";
import { controlPlaneSemanticWarnings, createDefaultControlPlaneDocument, loadControlPlaneSpecDocument, requireRunnableControlPlaneDocument } from "../../core/controlPlane/specs.js";
import { MockAgentAdapter, NoopAgentAdapter, ShellAgentAdapter, SiriusCouncilActuatorAdapter, type ControlPlaneAgentAdapter } from "../../core/controlPlane/adapters.js";
import { ReconciliationController } from "../../core/controlPlane/controller.js";
import { readControlPlaneReport, readControlPlaneStatus, StatusStore } from "../../core/controlPlane/statusStore.js";
import { resolveRuntimeConfig } from "../../core/runtime/runPreparation.js";

export async function controlInitCommand(cwd: string, options: { title?: string; mode?: string; output?: string; force?: boolean }): Promise<void> {
  const title = options.title ?? "Fix bug";
  const mode = parseMode(options.mode ?? "coding");
  const outputPath = path.resolve(cwd, options.output ?? "goal.yaml");
  if (existsSync(outputPath) && !options.force) {
    throw new Error(`Refusing to overwrite existing file: ${outputPath}. Use --force to replace it.`);
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  const document = createDefaultControlPlaneDocument(title, mode);
  await writeFile(outputPath, YAML.stringify(document), "utf8");
  process.stdout.write(`Created Canopus objective spec: ${outputPath}\n`);
}

export async function controlValidateCommand(cwd: string, goalPath: string, options: { json?: boolean } = {}): Promise<void> {
  const document = await loadControlPlaneSpecDocument(path.resolve(cwd, goalPath));
  const warnings = controlPlaneSemanticWarnings(document);
  if (options.json) {
    process.stdout.write(JSON.stringify({
      valid: true,
      goalId: document.goal.id,
      hasEvaluation: Boolean(document.evaluation),
      hasLoop: Boolean(document.loop),
      warnings
    }, null, 2) + "\n");
    return;
  }
  process.stdout.write([
    `valid CanopusObjective: ${document.goal.id}`,
    `title: ${document.goal.title}`,
    `mode: ${document.goal.mode}`,
    `required conditions: ${document.goal.desired_state.success_conditions.filter((item) => item.required).length}`,
    `blocking checks: ${document.evaluation?.hard_gates.length ?? 0}`,
    ...(warnings.length ? ["warnings:", ...warnings.map((warning) => `- ${warning}`)] : [])
  ].join("\n") + "\n");
}

export type ControlRunCliOptions = {
  cwd?: string;
  adapter?: string;
  actionCommand?: string;
  runId?: string;
  json?: boolean;
  config?: string;
  fixtureMode?: boolean;
  accessMode?: string;
  approvePatch?: boolean;
  approveShell?: boolean;
  simulateFailure?: string;
};

export async function controlRunCommand(cwd: string, goalPath: string, options: ControlRunCliOptions = {}): Promise<void> {
  const specPath = path.resolve(cwd, goalPath);
  const document = requireRunnableControlPlaneDocument(await loadControlPlaneSpecDocument(specPath));
  const targetCwd = path.resolve(cwd, options.cwd ?? ".");
  const adapter = await createAdapter({
    kind: options.adapter ?? "mock",
    actionCommand: options.actionCommand,
    cwd: targetCwd,
    rootCwd: cwd,
    goalDescription: document.goal.description,
    configPath: options.config,
    fixtureMode: options.fixtureMode,
    accessMode: parseAccessMode(options.accessMode),
    approvePatch: options.approvePatch,
    approveShell: options.approveShell,
    simulateFailure: options.simulateFailure
  });
  const result = await new ReconciliationController().run({
    cwd: targetCwd,
    goal: document.goal,
    evaluation: document.evaluation,
    loop: document.loop,
    adapter,
    runId: options.runId
  });
  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  process.stdout.write([
    `Canopus run ${result.runId}`,
    `phase: ${result.status.phase}`,
    `decision: ${result.status.decision.reason}`,
    `iterations: ${result.iterations}`,
    `runDir: ${result.runDir}`,
    `status: ${result.latestStatusPath}`,
    `trace: ${result.tracePath}`,
    `progress: ${result.progressPath}`
  ].join("\n") + "\n");
}

export async function controlStatusCommand(cwd: string, options: { runId?: string; cwd?: string; json?: boolean } = {}): Promise<void> {
  const targetCwd = path.resolve(cwd, options.cwd ?? ".");
  const runId = options.runId ?? await latestRunId(targetCwd);
  const status = await readControlPlaneStatus(targetCwd, runId);
  if (options.json) {
    process.stdout.write(JSON.stringify(status, null, 2) + "\n");
    return;
  }
  process.stdout.write([
    `Run: ${status.run_id}`,
    `Goal: ${status.goal_id}`,
    `Phase: ${status.phase}`,
    `Iteration: ${status.iteration}`,
    `Decision: ${status.decision.reason}`,
    `Missing: ${status.diff.missing_conditions.join(", ") || "-"}`,
    `Satisfied: ${status.diff.satisfied_conditions.join(", ") || "-"}`
  ].join("\n") + "\n");
}

export async function controlReportCommand(cwd: string, options: { runId?: string; cwd?: string } = {}): Promise<void> {
  const targetCwd = path.resolve(cwd, options.cwd ?? ".");
  const runId = options.runId ?? await latestRunId(targetCwd);
  process.stdout.write(await readControlPlaneReport(targetCwd, runId));
}

async function createAdapter(input: {
  kind: string;
  actionCommand?: string;
  cwd: string;
  rootCwd: string;
  goalDescription: string;
  configPath?: string;
  fixtureMode?: boolean;
  accessMode?: AccessMode;
  approvePatch?: boolean;
  approveShell?: boolean;
  simulateFailure?: string;
}): Promise<ControlPlaneAgentAdapter> {
  const kind = input.kind;
  if (kind === "mock") return new MockAgentAdapter();
  if (kind === "noop") return new NoopAgentAdapter();
  if (kind === "shell") {
    if (!input.actionCommand) throw new Error("--action-command is required when --adapter shell is used.");
    return new ShellAgentAdapter(input.actionCommand);
  }
  if (kind === "sirius-council") {
    const explicitConfigPath = input.configPath ? path.resolve(input.rootCwd, input.configPath) : undefined;
    const runtimeConfig = await resolveRuntimeConfig(input.cwd, {
      task: input.goalDescription,
      configPath: explicitConfigPath
    });
    return new SiriusCouncilActuatorAdapter(runtimeConfig.config, {
      fixtureMode: input.fixtureMode,
      accessMode: input.accessMode,
      approvePatch: input.approvePatch,
      approveShell: input.approveShell,
      simulateFailureTaskId: input.simulateFailure
    });
  }
  throw new Error(`Unsupported control adapter "${kind}". Allowed values: mock, noop, shell, sirius-council.`);
}

async function latestRunId(cwd: string): Promise<string> {
  const runsRoot = path.resolve(cwd, ".runs");
  const entries = await readdir(runsRoot).catch(() => [] as string[]);
  const candidates: Array<{ id: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    const store = new StatusStore(cwd, entry);
    if (!existsSync(store.latestPath)) continue;
    const info = await stat(store.latestPath);
    candidates.push({ id: entry, mtimeMs: info.mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const latest = candidates[0]?.id;
  if (!latest) throw new Error("No Canopus run found.");
  return latest;
}

function parseMode(value: string): ReturnType<typeof createDefaultControlPlaneDocument>["goal"]["mode"] {
  return z.enum(["coding", "research", "refactor", "test", "docs", "generic"]).parse(value);
}

function parseAccessMode(value: string | undefined): AccessMode | undefined {
  if (!value) return undefined;
  const parsed = accessModeSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid access mode "${value}". Use restricted, partial, or full.`);
  return parsed.data;
}
