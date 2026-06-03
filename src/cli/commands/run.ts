import { loadConfig } from "../../config/configLoader.js";
import type { AccessMode } from "../../config/schema.js";
import { runOfflineGraph } from "../../core/agentGraph/executor.js";
import { saveSession } from "../../core/memory/sessionMemory.js";
import { loadProjectPreferences } from "../../core/memory/preferences.js";

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
  fixtureFailingPatch?: boolean;
  testCommand?: string;
  image?: string[];
};

export async function runCommand(cwd: string, goal: string, options: RunOptions = {}): Promise<void> {
  const loadedConfig = loadConfig(cwd);
  const prefs = loadProjectPreferences(cwd);
  const config = prefs.routingMode ? { ...loadedConfig, routing: { ...loadedConfig.routing, mode: prefs.routingMode } } : loadedConfig;
  const state = await runOfflineGraph(cwd, goal, config, {
    provider: options.provider,
    approvePatch: options.approvePatch,
    approveShell: options.approveShell,
    approveRepair: options.approveRepair,
    accessMode: options.accessMode ?? prefs.accessMode,
    repairOnFail: options.repairOnFail,
    redTeamReview: options.redTeamReview,
    liveAdvisory: options.liveAdvisory ?? prefs.preferredLiveAdvisory,
    livePatch: options.livePatch ?? prefs.preferredLivePatch,
    fixtureFailingPatch: options.fixtureFailingPatch,
    testCommand: options.testCommand ?? prefs.preferredTestCommand,
    imagePaths: options.image ?? []
  });
  const sessionPath = await saveSession(cwd, state);
  if (options.headless) {
    process.stdout.write(JSON.stringify({ sessionPath, access: state.access, approvals: state.approvals, capabilityRoute: state.capabilityRoute, visualSpec: state.visualSpec, review: state.review, judge: state.judge, debateRounds: state.debateRounds, modelNotes: state.modelNotes, usageSummary: state.usageSummary, budgetStatus: state.budgetStatus, changedFiles: state.changedFiles, runResults: state.runResults, repairCandidates: state.repairCandidates, summary: state.finalSummary }, null, 2) + "\n");
    return;
  }
  const { render } = await import("ink");
  const React = await import("react");
  const { App } = await import("../../tui/App.js");
  render(React.createElement(App, { graph: state, safeMode: config.project.safe_mode, cwd }));
}
