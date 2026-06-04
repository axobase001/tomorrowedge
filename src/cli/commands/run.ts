import { existsSync } from "node:fs";
import { cp, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../config/configLoader.js";
import { accessModeSchema, type AccessMode } from "../../config/schema.js";
import { saveSession } from "../../core/memory/sessionMemory.js";
import { loadProjectPreferences } from "../../core/memory/preferences.js";
import { NativeBackend } from "../../core/orchestration/nativeBackend.js";
import { createOrchestrationBackend } from "../../core/orchestration/registry.js";
import { getGitStatus } from "../../core/tools/gitTool.js";
import { renderCockpit } from "../renderCockpit.js";

export type RunOptions = {
  headless?: boolean;
  provider?: string;
  fixtureMode?: boolean;
  approvePatch?: boolean;
  approveShell?: boolean;
  approveRepair?: boolean;
  accessMode?: AccessMode;
  repairOnFail?: boolean;
  redTeamReview?: boolean;
  live?: boolean;
  offline?: boolean;
  liveAdvisory?: boolean;
  livePatch?: boolean;
  liveVision?: boolean;
  fixtureFailingPatch?: boolean;
  testCommand?: string;
  image?: string[];
};

export async function runCommand(cwd: string, goal: string, options: RunOptions = {}): Promise<void> {
  const accessMode = parseAccessMode(options.accessMode);
  const imagePaths = validateImageInputs(cwd, options.image ?? []);
  const loadedConfig = loadConfig(cwd);
  const prefs = loadProjectPreferences(cwd);
  const config = prefs.routingMode ? { ...loadedConfig, routing: { ...loadedConfig.routing, mode: prefs.routingMode } } : loadedConfig;
  const effectiveAccessMode = accessMode ?? prefs.accessMode ?? config.project.access_mode;
  const autoLive = shouldAutoLive(config, options);
  if (options.live && options.offline) {
    throw new Error("Use either --live or --offline, not both.");
  }
  const workspace = await prepareRunWorkspace(cwd, options);
  if (effectiveAccessMode === "full") {
    await warnFullMode(workspace.executionCwd);
  }
  const backend = createOrchestrationBackend(config);
  const backendInput = {
    cwd: workspace.executionCwd,
    goal,
    options: {
      provider: options.provider,
      fixtureMode: isFixtureRun(options),
      approvePatch: options.approvePatch,
      approveShell: options.approveShell,
      approveRepair: options.approveRepair,
      accessMode: effectiveAccessMode,
      repairOnFail: options.repairOnFail,
      redTeamReview: options.redTeamReview,
      liveAdvisory: liveOption(options.offline, options.live, autoLive, options.liveAdvisory ?? prefs.preferredLiveAdvisory),
      livePatch: liveOption(options.offline, options.live, autoLive, options.livePatch ?? prefs.preferredLivePatch),
      liveVision: liveOption(options.offline, options.live, autoLive && imagePaths.length > 0, options.liveVision),
      fixtureFailingPatch: options.fixtureFailingPatch,
      testCommand: options.testCommand ?? prefs.preferredTestCommand,
      imagePaths
    }
  };
  if (!(backend instanceof NativeBackend)) {
    for await (const _event of backend.run(backendInput)) {
      // Placeholder backends currently throw before yielding events.
    }
    throw new Error(`Backend ${backend.id} completed without producing a native graph state.`);
  }
  const state = await backend.runGraph(workspace.executionCwd, goal, backendInput.options);
  const sessionPath = await saveSession(cwd, state);
  if (options.headless) {
    const headlessPayload = {
      sessionPath,
      executionCwd: workspace.executionCwd,
      fixtureWorkspace: workspace.fixtureWorkspace,
      access: state.access,
      agents: state.agents.map(a => ({ role: a.role, provider: a.provider, model: a.model, kind: a.agentKind ?? "offline", status: a.status, summary: a.summary })),
      approvals: state.approvals,
      capabilityRoute: state.capabilityRoute,
      visualSpec: state.visualSpec,
      review: state.review,
      judge: state.judge,
      debateRounds: state.debateRounds,
      modelNotes: state.modelNotes,
      usageSummary: state.usageSummary,
      budgetStatus: state.budgetStatus,
      changedFiles: state.changedFiles,
      runResults: state.runResults,
      repairCandidates: state.repairCandidates,
      summary: state.finalSummary
    };
    process.stdout.write(JSON.stringify(headlessPayload, null, 2) + "\n");
    return;
  }
  await renderCockpit(state, config.project.safe_mode, workspace.executionCwd);
}

export type RunWorkspace = {
  executionCwd: string;
  fixtureWorkspace?: string;
};

export async function prepareRunWorkspace(cwd: string, options: Pick<RunOptions, "provider" | "fixtureMode">): Promise<RunWorkspace> {
  if (!isFixtureRun(options)) {
    return { executionCwd: cwd };
  }

  if (existsSync(path.join(cwd, "index.js")) && existsSync(path.join(cwd, "package.json"))) {
    return { executionCwd: cwd };
  }

  const fixtureSource = path.join(cwd, "tests", "fixtures", "sample-repo-basic");
  if (!existsSync(path.join(fixtureSource, "index.js")) || !existsSync(path.join(fixtureSource, "package.json"))) {
    return { executionCwd: cwd };
  }

  const fixtureWorkspace = await mkdtemp(path.join(os.tmpdir(), "tedge-fixture-demo-"));
  await cp(fixtureSource, fixtureWorkspace, { recursive: true });
  return { executionCwd: fixtureWorkspace, fixtureWorkspace };
}

function parseAccessMode(mode?: string): AccessMode | undefined {
  if (mode === undefined) return undefined;
  const parsed = accessModeSchema.safeParse(mode);
  if (!parsed.success) {
    throw new Error(`Invalid access mode: ${mode}. Use restricted, partial, or full.`);
  }
  return parsed.data;
}

function liveOption(offline: boolean | undefined, live: boolean | undefined, autoLive: boolean, explicit: boolean | undefined): boolean {
  if (offline) return false;
  if (live) return true;
  if (explicit !== undefined) return explicit;
  return autoLive;
}

function shouldAutoLive(config: ReturnType<typeof loadConfig>, options: RunOptions): boolean {
  if (options.offline || isFixtureRun(options)) return false;
  if (options.live) return true;
  return Object.entries(config.providers).some(([id, provider]) => {
    if (!provider.enabled || !provider.base_url || provider.auth_header === "none") return false;
    if (["anthropic", "gemini"].includes(id)) return false;
    return Boolean(provider.api_key_env && process.env[provider.api_key_env]);
  });
}

function isFixtureRun(options: Pick<RunOptions, "provider" | "fixtureMode">): boolean {
  return Boolean(options.fixtureMode || options.provider === "fixture");
}

async function warnFullMode(cwd: string): Promise<void> {
  const gitStatus = await getGitStatus(cwd).catch(() => "not a git repository");
  process.stderr.write("Warning: FULL AUTONOMY is enabled. Patch, shell, and repair actions may run without per-step approval.\n");
  if (gitStatus !== "clean") {
    process.stderr.write(`Warning: workspace is ${gitStatus}. Prefer a clean repo, sandbox, or fixture before full mode.\n`);
  }
}

function validateImageInputs(cwd: string, imagePaths: string[]): string[] {
  return imagePaths.map((imagePath) => {
    const resolved = path.isAbsolute(imagePath) ? imagePath : path.resolve(cwd, imagePath);
    if (!existsSync(resolved)) {
      throw new Error(`Image input not found: ${imagePath}`);
    }
    return resolved;
  });
}
