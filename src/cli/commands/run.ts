import { existsSync } from "node:fs";
import { cp, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../config/configLoader.js";
import type { AccessMode } from "../../config/schema.js";
import { runOfflineGraph } from "../../core/agentGraph/executor.js";
import { saveSession } from "../../core/memory/sessionMemory.js";
import { loadProjectPreferences } from "../../core/memory/preferences.js";
import { renderInteractiveApp } from "../../tui/renderApp.js";

export type RunOptions = {
  headless?: boolean;
  provider?: string;
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
  const loadedConfig = loadConfig(cwd);
  const prefs = loadProjectPreferences(cwd);
  const config = prefs.routingMode ? { ...loadedConfig, routing: { ...loadedConfig.routing, mode: prefs.routingMode } } : loadedConfig;
  const workspace = await prepareRunWorkspace(cwd, options);
  const state = await runOfflineGraph(workspace.executionCwd, goal, config, {
    provider: options.provider,
    approvePatch: options.approvePatch,
    approveShell: options.approveShell,
    approveRepair: options.approveRepair,
    accessMode: options.accessMode ?? prefs.accessMode,
    repairOnFail: options.repairOnFail,
    redTeamReview: options.redTeamReview,
    liveAdvisory: options.liveAdvisory ?? prefs.preferredLiveAdvisory,
    livePatch: options.livePatch ?? prefs.preferredLivePatch,
    liveVision: options.liveVision,
    fixtureFailingPatch: options.fixtureFailingPatch,
    testCommand: options.testCommand ?? prefs.preferredTestCommand,
    imagePaths: options.image ?? []
  });
  const sessionPath = await saveSession(cwd, state);
  if (options.headless) {
    process.stdout.write(JSON.stringify({ sessionPath, executionCwd: workspace.executionCwd, fixtureWorkspace: workspace.fixtureWorkspace, access: state.access, approvals: state.approvals, capabilityRoute: state.capabilityRoute, visualSpec: state.visualSpec, review: state.review, judge: state.judge, debateRounds: state.debateRounds, modelNotes: state.modelNotes, usageSummary: state.usageSummary, budgetStatus: state.budgetStatus, changedFiles: state.changedFiles, runResults: state.runResults, repairCandidates: state.repairCandidates, summary: state.finalSummary }, null, 2) + "\n");
    return;
  }
  await renderInteractiveApp({ graph: state, safeMode: config.project.safe_mode, cwd: workspace.executionCwd, commandName: "tedge run" });
}

export type RunWorkspace = {
  executionCwd: string;
  fixtureWorkspace?: string;
};

export async function prepareRunWorkspace(cwd: string, options: Pick<RunOptions, "provider">): Promise<RunWorkspace> {
  if (options.provider !== "fixture") {
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
