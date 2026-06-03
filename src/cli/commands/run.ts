import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../../config/configLoader.js";
import { accessModeSchema, type AccessMode } from "../../config/schema.js";
import { saveSession } from "../../core/memory/sessionMemory.js";
import { loadProjectPreferences } from "../../core/memory/preferences.js";
import { NativeBackend } from "../../core/orchestration/nativeBackend.js";
import { createOrchestrationBackend } from "../../core/orchestration/registry.js";
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
  const backend = createOrchestrationBackend(config);
  const backendInput = {
    cwd,
    goal,
    options: {
      provider: options.provider,
      fixtureMode: options.fixtureMode,
      approvePatch: options.approvePatch,
      approveShell: options.approveShell,
      approveRepair: options.approveRepair,
      accessMode: accessMode ?? prefs.accessMode,
      repairOnFail: options.repairOnFail,
      redTeamReview: options.redTeamReview,
      liveAdvisory: options.liveAdvisory ?? prefs.preferredLiveAdvisory,
      livePatch: options.livePatch ?? prefs.preferredLivePatch,
      liveVision: options.liveVision,
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
  const state = await backend.runGraph(cwd, goal, backendInput.options);
  const sessionPath = await saveSession(cwd, state);
  if (options.headless) {
    process.stdout.write(JSON.stringify({ sessionPath, access: state.access, agents: state.agents.map(a => ({ role: a.role, provider: a.provider, model: a.model, kind: a.agentKind ?? "offline", status: a.status, summary: a.summary })), approvals: state.approvals, capabilityRoute: state.capabilityRoute, visualSpec: state.visualSpec, review: state.review, judge: state.judge, debateRounds: state.debateRounds, modelNotes: state.modelNotes, usageSummary: state.usageSummary, budgetStatus: state.budgetStatus, changedFiles: state.changedFiles, runResults: state.runResults, repairCandidates: state.repairCandidates, summary: state.finalSummary }, null, 2) + "\n");
    return;
  }
  await renderCockpit(state, config.project.safe_mode, cwd);
}

function parseAccessMode(mode?: string): AccessMode | undefined {
  if (mode === undefined) return undefined;
  const parsed = accessModeSchema.safeParse(mode);
  if (!parsed.success) {
    throw new Error(`Invalid access mode: ${mode}. Use restricted, partial, or full.`);
  }
  return parsed.data;
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
