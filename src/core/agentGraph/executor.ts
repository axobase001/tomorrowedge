import type { AccessMode, TomorrowEdgeConfig } from "../../config/schema.js";
import type { AgentRole, AgentRunState } from "../../schemas/agentTask.js";
import { nowIso } from "../../utils/time.js";
import { CoderAgent } from "../agents/coder.js";
import { ExplorerAgent } from "../agents/explorer.js";
import { JudgeAgent } from "../agents/judge.js";
import { PlannerAgent } from "../agents/planner.js";
import { VisionAgent } from "../agents/vision.js";
import { ReviewerAgent } from "../agents/reviewer.js";
import { RepairerAgent } from "../agents/repairer.js";
import { SummarizerAgent } from "../agents/summarizer.js";
import { applyUnifiedDiff } from "../patch/patchApplier.js";
import { ModelRouter } from "../routing/router.js";
import { runTestCommand } from "../verifier/testRunner.js";
import { evidenceFromRun } from "../verifier/evidenceMatcher.js";
import type { AgentGraphState } from "./state.js";
import { buildAdvisoryPlans, runLiveAdvisory } from "../model/modelAdvisory.js";
import { preflightBudget, summarizeModelUsage } from "../model/costAccounting.js";
import { buildAccessPolicy } from "../permissions/accessPolicy.js";
import { buildLivePatchPlans, runLivePatchCandidates } from "../model/livePatchGenerator.js";
import { buildVisionCostPrompt, estimateVisionInputTokens, runLiveVisionSpec } from "../model/liveVisionSpec.js";
import { buildDebateRounds } from "../debate/debateEngine.js";
import { buildCapabilityRoute } from "../capabilities/capabilityStitching.js";

export type OfflineGraphOptions = {
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
  imagePaths?: string[];
};

export async function runOfflineGraph(cwd: string, goal: string, config: TomorrowEdgeConfig, options: OfflineGraphOptions = {}): Promise<AgentGraphState> {
  const router = new ModelRouter(config);
  const access = buildAccessPolicy(config, {
    mode: options.accessMode,
    approvePatch: options.approvePatch,
    approveShell: options.approveShell,
    approveRepair: options.approveRepair
  });
  const state: AgentGraphState = {
    goal,
    routing: router.getPlan(),
    access,
    agents: [],
    candidates: [],
    repairCandidates: [],
    debateRounds: [],
    modelNotes: [],
    usageSummary: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    changedFiles: [],
    runResults: [],
    approvals: {
      patchApproved: access.patchApproved,
      shellApproved: access.shellApproved,
      repairApproved: access.repairApproved
    }
  };

  const imagePaths = options.imagePaths ?? [];
  state.capabilityRoute = buildCapabilityRoute({ goal, imagePaths, router });
  if (imagePaths.length) {
    const vision = new VisionAgent();
    if (options.liveVision && access.cloudAllowed) {
      const assignment = router.assignmentFor("vision");
      state.budgetStatus = preflightBudget(
        [{ provider: assignment.provider, prompt: buildVisionCostPrompt(goal, imagePaths), estimatedInputTokens: estimateVisionInputTokens(goal, imagePaths), maxOutputTokens: 1200 }],
        config.routing.max_cost_usd
      );
      if (state.budgetStatus.status !== "blocked") {
        const liveVision = await runAgentState(state, router, "vision", () => runLiveVisionSpec({ goal, imagePaths, config, router }));
        state.modelNotes.push(liveVision.note);
        state.usageSummary = summarizeModelUsage(state.modelNotes);
        state.visualSpec = liveVision.spec;
      }
    } else if (options.liveVision && !access.cloudAllowed) {
      state.budgetStatus = {
        status: "blocked",
        maxCostUsd: config.routing.max_cost_usd,
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0,
        reason: `Live vision blocked by access mode: ${access.mode}.`
      };
    }
    if (!state.visualSpec) {
      state.visualSpec = await runAgentState(state, router, "vision", () => vision.run({ goal, imagePaths }));
    }
    state.capabilityRoute = buildCapabilityRoute({ goal, imagePaths, router, visualSpec: state.visualSpec });
  }

  const planner = new PlannerAgent();
  const plannerGoal = state.visualSpec ? `${goal}\n\n${state.visualSpec.handoffPrompt}` : goal;
  state.plan = await runAgentState(state, router, "planner", () => planner.run({ goal: plannerGoal }));

  const explorer = new ExplorerAgent();
  state.contextSelection = await runAgentState(state, router, "explorer", () => explorer.run({ plan: state.plan! }, { cwd, router }));

  const coder = new CoderAgent();
  state.candidates.push(await runAgentState(state, router, "coder_a", () => coder.run({ plan: state.plan!, contextSelection: state.contextSelection!, variant: "a", fixtureMode: options.provider === "fixture", fixtureFailingPatch: options.fixtureFailingPatch, visualSpec: state.visualSpec })));
  if (config.debate.enabled && config.debate.max_candidates > 1) {
    state.candidates.push(await runAgentState(state, router, "coder_b", () => coder.run({ plan: state.plan!, contextSelection: state.contextSelection!, variant: "b", fixtureMode: options.provider === "fixture", fixtureFailingPatch: options.fixtureFailingPatch, visualSpec: state.visualSpec })));
  }

  if (options.livePatch && access.cloudAllowed) {
    const livePatchInput = {
      cwd,
      goal,
      config,
      router,
      plan: state.plan!,
      contextSelection: state.contextSelection!,
      visualSpec: state.visualSpec
    };
    const patchPlans = await buildLivePatchPlans(livePatchInput);
    state.budgetStatus = preflightBudget(
      patchPlans.map((plan) => ({ provider: plan.provider, prompt: plan.prompt, maxOutputTokens: plan.maxOutputTokens })),
      config.routing.max_cost_usd
    );
    if (state.budgetStatus.status !== "blocked") {
      const livePatchResult = await runLivePatchCandidates(livePatchInput);
      state.candidates.push(...livePatchResult.candidates);
      state.modelNotes.push(...livePatchResult.notes);
      state.usageSummary = summarizeModelUsage(state.modelNotes);
    }
  } else if (options.livePatch && !access.cloudAllowed) {
    state.budgetStatus = {
      status: "blocked",
      maxCostUsd: config.routing.max_cost_usd,
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
      reason: `Live patch generation blocked by access mode: ${access.mode}.`
    };
  }

  const reviewer = new ReviewerAgent();
  state.review = await runAgentState(state, router, "reviewer", () => reviewer.run({ candidates: state.candidates, redTeam: options.redTeamReview }));
  state.debateRounds = buildDebateRounds(state.candidates, state.review, config.debate.max_rounds);

  const judge = new JudgeAgent();
  state.judge = await runAgentState(state, router, "judge", () => judge.run({ candidates: state.candidates, review: state.review! }));

  if (options.liveAdvisory && access.cloudAllowed) {
    const advisoryInput = {
      cwd,
      goal,
      config,
      router,
      plan: state.plan,
      candidates: state.candidates,
      review: state.review,
      visualSpec: state.visualSpec
    };
    const advisoryPlans = buildAdvisoryPlans(advisoryInput);
    state.budgetStatus = preflightBudget(
      advisoryPlans.map((plan) => ({ provider: plan.provider, prompt: plan.prompt, maxOutputTokens: plan.maxOutputTokens })),
      config.routing.max_cost_usd
    );
    if (state.budgetStatus.status !== "blocked") {
      state.modelNotes.push(...await runLiveAdvisory(advisoryInput));
      state.usageSummary = summarizeModelUsage(state.modelNotes);
    }
  } else if (options.liveAdvisory && !access.cloudAllowed) {
    state.budgetStatus = {
      status: "blocked",
      maxCostUsd: config.routing.max_cost_usd,
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
      reason: `Live advisory blocked by access mode: ${access.mode}.`
    };
  }

  if (state.judge.decision === "select" && state.judge.selectedCandidateId) {
    const selected = state.candidates.find((candidate) => candidate.candidateId === state.judge!.selectedCandidateId);
    if (selected?.unifiedDiff) {
      try {
        state.changedFiles = await runAgentState(state, router, "runner", () => applyUnifiedDiff(cwd, selected.unifiedDiff, access.patchAllowed && access.patchApproved));
      } catch (error) {
        state.agents.push({
          id: "approval_patch",
          role: "runner",
          provider: "local_tool",
          model: "approval_gate",
          status: "waiting_for_user",
          summary: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  const testCommand = options.testCommand ?? state.plan.verificationCommands?.[0];
  if (state.changedFiles.length && testCommand) {
    try {
      const result = await runAgentState(state, router, "runner", () => runTestCommand(cwd, testCommand, access.shellAllowed && access.shellApproved));
      state.runResults.push(result);
      if (!result.success && options.repairOnFail) {
        const repairer = new RepairerAgent();
        const repairCandidate = await runAgentState(state, router, "repairer", () =>
          repairer.run({ plan: state.plan!, failedRun: result, appliedFiles: state.changedFiles, fixtureMode: options.provider === "fixture" })
        );
        state.repairCandidates.push(repairCandidate);
        if (repairCandidate.unifiedDiff) {
          try {
            const repairedFiles = await runAgentState(state, router, "runner", () => applyUnifiedDiff(cwd, repairCandidate.unifiedDiff, access.repairAllowed && access.repairApproved));
            state.changedFiles = [...new Set([...state.changedFiles, ...repairedFiles])];
            const repairedRun = await runAgentState(state, router, "runner", () => runTestCommand(cwd, testCommand, access.shellAllowed && access.shellApproved));
            state.runResults.push(repairedRun);
          } catch (error) {
            state.agents.push({
              id: "approval_repair",
              role: "runner",
              provider: "local_tool",
              model: "approval_gate",
              status: "waiting_for_user",
              summary: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }
    } catch (error) {
      state.agents.push({
        id: "approval_shell",
        role: "runner",
        provider: "local_tool",
        model: "approval_gate",
        status: "waiting_for_user",
        summary: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const summarizer = new SummarizerAgent();
  state.finalSummary = await runAgentState(state, router, "summarizer", () =>
    summarizer.run({
      plan: state.plan!,
      changedFiles: state.changedFiles,
      testsRun: state.runResults.map((result) => result.command),
      evidence: [
        "offline graph completed",
        ...(state.visualSpec ? [`capability stitching visual spec: ${state.visualSpec.summary}`] : []),
        ...state.runResults.map(evidenceFromRun)
      ]
    })
  );

  return state;
}

async function runAgentState<T>(state: AgentGraphState, router: ModelRouter, role: AgentRole, fn: () => Promise<T>): Promise<T> {
  const assignment = router.assignmentFor(role);
  const agentState: AgentRunState = {
    id: role,
    role,
    provider: assignment.provider,
    model: assignment.model,
    status: "running",
    startedAt: nowIso(),
    summary: assignment.reason
  };
  state.agents.push(agentState);
  const start = Date.now();
  try {
    const result = await fn();
    agentState.status = "success";
    agentState.summary = `${role} completed`;
    updateCapabilityStep(state, role, "success", agentState.summary);
    return result;
  } catch (error) {
    agentState.status = "failed";
    agentState.summary = error instanceof Error ? error.message : String(error);
    updateCapabilityStep(state, role, "blocked", agentState.summary);
    throw error;
  } finally {
    agentState.endedAt = nowIso();
    agentState.elapsedMs = Date.now() - start;
  }
}

function updateCapabilityStep(state: AgentGraphState, role: AgentRole, status: "success" | "blocked", summary: string): void {
  if (!state.capabilityRoute) return;
  state.capabilityRoute = {
    ...state.capabilityRoute,
    steps: state.capabilityRoute.steps.map((step) => (step.role === role ? { ...step, status, summary } : step))
  };
}
