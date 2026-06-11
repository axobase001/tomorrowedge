import { existsSync } from "node:fs";
import path from "node:path";
import { accessModeSchema, type AccessMode } from "../../config/schema.js";
import { saveSession } from "../../core/memory/sessionMemory.js";
import { NativeBackend } from "../../core/orchestration/nativeBackend.js";
import { createOrchestrationBackend } from "../../core/orchestration/registry.js";
import { savePolicyScore } from "../../core/orchestrationPolicy/policyStore.js";
import { describeAccessPolicy } from "../../core/permissions/accessPolicy.js";
import { getGitStatus } from "../../core/tools/gitTool.js";
import { addTrace } from "../../core/traces/traceStore.js";
import { renderCockpit } from "../renderCockpit.js";
import { getWorkflowRecipe, materializeRecipeGoal } from "../../core/recipes/recipeLoader.js";
import { liveOption, prepareRunWorkspace, resolveRuntimeConfig, shouldAutoLive, isFixtureRun, isKnownFixtureSampleRepo } from "../../core/runtime/runPreparation.js";

export { prepareRunWorkspace, type RunWorkspace } from "../../core/runtime/runPreparation.js";

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
  to?: string;
  cwd?: string;
  recipe?: string;
};

export async function runCommand(cwd: string, goal: string, options: RunOptions = {}): Promise<void> {
  const targetCwd = options.cwd ? path.resolve(cwd, options.cwd) : cwd;
  const recipe = options.recipe ? getWorkflowRecipe(options.recipe) : undefined;
  if (options.recipe && !recipe) throw new Error(`Unknown workflow recipe "${options.recipe}". Run "tedge recipes" to list available recipes.`);
  const effectiveGoal = recipe ? materializeRecipeGoal(recipe, goal) : goal.trim();
  if (!effectiveGoal) throw new Error("Task goal is required unless --recipe supplies a default goal.");
  const accessMode = parseAccessMode(options.accessMode);
  const imagePaths = validateImageInputs(targetCwd, options.image ?? []);
  const { prefs, memoryHints, config } = await resolveRuntimeConfig(targetCwd, { task: effectiveGoal });
  const effectiveAccessMode = accessMode ?? recipe?.accessMode ?? prefs.accessMode ?? config.project.access_mode;
  const autoLive = shouldAutoLive(config, options);
  if (options.live && options.offline) {
    throw new Error("Use either --live or --offline, not both.");
  }
  const workspace = await prepareRunWorkspace(targetCwd, options);
  warnFixtureModeScope(workspace, options);
  if (effectiveAccessMode === "full") {
    await warnFullMode(workspace.executionCwd);
  }
  const backend = createOrchestrationBackend(config);
  const backendInput = {
    cwd: workspace.executionCwd,
    goal: effectiveGoal,
    options: {
      provider: options.provider,
      fixtureMode: isFixtureRun(options),
      approvePatch: options.approvePatch,
      approveShell: options.approveShell,
      approveRepair: options.approveRepair,
      accessMode: effectiveAccessMode,
      repairOnFail: options.repairOnFail ?? recipe?.options?.repairOnFail,
      redTeamReview: options.redTeamReview ?? recipe?.options?.redTeamReview,
      liveAdvisory: liveOption(options.offline, options.live, autoLive, options.liveAdvisory ?? recipe?.options?.liveAdvisory ?? prefs.preferredLiveAdvisory),
      livePatch: liveOption(options.offline, options.live, autoLive, options.livePatch ?? recipe?.options?.livePatch ?? prefs.preferredLivePatch),
      liveVision: liveOption(options.offline, options.live, autoLive && imagePaths.length > 0, options.liveVision),
      fixtureFailingPatch: options.fixtureFailingPatch,
      testCommand: options.testCommand ?? recipe?.options?.testCommand ?? prefs.preferredTestCommand ?? (config.strategy_memory.suggest_test_command ? memoryHints?.preferredTestCommand : undefined),
      imagePaths,
      conversationTarget: options.to
    }
  };
  if (!(backend instanceof NativeBackend)) {
    for await (const _event of backend.run(backendInput)) {
      // Placeholder backends currently throw before yielding events.
    }
    throw new Error(`Backend ${backend.id} completed without producing a native graph state.`);
  }
  const state = await backend.runGraph(workspace.executionCwd, effectiveGoal, backendInput.options);
  const sessionPath = await saveSession(targetCwd, state, { failureMemory: config.failure_memory });
  await persistRunLearning(targetCwd, state);
  if (options.headless) {
    const headlessPayload = {
      sessionPath,
      executionCwd: workspace.executionCwd,
      fixtureWorkspace: workspace.fixtureWorkspace,
      access: state.access,
      accessSummary: describeAccessPolicy(state.access),
      agents: state.agents.map(a => ({ role: a.role, provider: a.provider, model: a.model, kind: a.agentKind ?? "offline", status: a.status, summary: a.summary })),
      approvals: state.approvals,
      capabilityRoute: state.capabilityRoute,
      conversationTarget: state.conversationTarget,
      scenarioProfile: state.scenarioProfile,
      objectiveContract: state.objectiveContract,
      contractVerification: state.contractVerification,
      objectiveTrace: state.objectiveTrace,
      orchestrationPolicy: state.orchestrationPolicy,
      visualSpec: state.visualSpec,
      review: state.review,
      judge: state.judge,
      debateRounds: state.debateRounds,
      modelNotes: state.modelNotes,
      usageSummary: state.usageSummary,
      budgetStatus: state.budgetStatus,
      budgetStatuses: state.budgetStatuses,
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

async function persistRunLearning(cwd: string, state: Awaited<ReturnType<NativeBackend["runGraph"]>>): Promise<void> {
  if (state.objectiveTrace) {
    await addTrace(cwd, state.objectiveTrace).catch(() => undefined);
  }
  if (state.orchestrationPolicy?.metadata.fitness !== undefined) {
    await savePolicyScore(cwd, state.orchestrationPolicy).catch(() => undefined);
  }
}

function parseAccessMode(mode?: string): AccessMode | undefined {
  if (mode === undefined) return undefined;
  const parsed = accessModeSchema.safeParse(mode);
  if (!parsed.success) {
    throw new Error(`invalid access mode "${mode}". Allowed values: restricted, partial, or full.`);
  }
  return parsed.data;
}

async function warnFullMode(cwd: string): Promise<void> {
  const gitStatus = await getGitStatus(cwd).catch(() => "not a git repository");
  process.stderr.write("Warning: FULL AUTONOMY is enabled. Patch, shell, and repair actions may run without per-step approval.\n");
  if (gitStatus !== "clean") {
    process.stderr.write(`Warning: workspace is ${gitStatus}. Prefer a clean repo, sandbox, or fixture before full mode.\n`);
  }
}

function warnFixtureModeScope(workspace: { executionCwd: string; fixtureWorkspace?: string }, options: RunOptions): void {
  if (!isFixtureRun(options)) return;
  if (workspace.fixtureWorkspace) return;
  if (isKnownFixtureSampleRepo(workspace.executionCwd)) return;
  process.stderr.write("Warning: fixture-mode may not produce valid diffs for arbitrary repositories.\n");
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
