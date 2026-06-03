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
import { applyUnifiedDiffWithResult } from "../patch/patchApplier.js";
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
import { createEventLedger, type EventLedger } from "../events/eventLedger.js";
import type { ModelNote } from "../../schemas/modelNote.js";
import type { PatchCandidate } from "../../schemas/patchCandidate.js";
import type { RunResult } from "../../schemas/evidence.js";

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
  const ledger = createEventLedger(access.mode);
  const state: AgentGraphState = {
    sessionId: ledger.sessionId,
    goal,
    routing: router.getPlan(),
    access,
    events: ledger.events,
    eventArtifacts: ledger.artifacts,
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
  ledger.append({
    type: "access_mode",
    phase: "routing",
    accessMode: access.mode,
    cloudAllowed: access.cloudAllowed,
    patchApproved: access.patchApproved,
    shellApproved: access.shellApproved,
    repairApproved: access.repairApproved,
    description: accessModeDescription(access.mode)
  });
  ledger.append({
    type: "evidence_update",
    phase: "routing",
    evidence: [`routing mode=${state.routing.mode}`, `access mode=${state.access.mode}`, `assignments=${state.routing.assignments.length}`]
  });

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
        const liveVision = await runAgentState(state, ledger, router, "vision", () => runLiveVisionSpec({ goal, imagePaths, config, router, ledger }));
        state.modelNotes.push(liveVision.note);
        state.usageSummary = summarizeModelUsage(state.modelNotes);
        recordModelNoteEvents(ledger, [liveVision.note], state.usageSummary);
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
      ledger.append({ type: "autonomy_limit_reached", phase: "vision", status: "blocked_by_budget", reason: state.budgetStatus.reason });
    }
    if (!state.visualSpec) {
      state.visualSpec = await runAgentState(state, ledger, router, "vision", () => vision.run({ goal, imagePaths }));
    }
    ledger.append({
      type: "evidence_update",
      phase: "vision",
      role: "vision",
      evidence: [state.visualSpec.summary],
      evidenceRef: ledger.writeArtifact("visual_specs", JSON.stringify(state.visualSpec, null, 2), "json")
    });
    state.capabilityRoute = buildCapabilityRoute({ goal, imagePaths, router, visualSpec: state.visualSpec });
  }

  const planner = new PlannerAgent();
  const plannerGoal = state.visualSpec ? `${goal}\n\n${state.visualSpec.handoffPrompt}` : goal;
  state.plan = await runAgentState(state, ledger, router, "planner", () => planner.run({ goal: plannerGoal }));
  ledger.append({ type: "evidence_update", phase: "planning", role: "planner", evidence: state.plan.steps.map((step) => step.title), evidenceRef: ledger.writeArtifact("summaries", JSON.stringify(state.plan, null, 2), "json") });

  const explorer = new ExplorerAgent();
  state.contextSelection = await runAgentState(state, ledger, router, "explorer", () => explorer.run({ plan: state.plan! }, { cwd, router }));
  ledger.append({
    type: "context_select",
    phase: "exploration",
    role: "explorer",
    selectedFiles: state.contextSelection.selectedFiles.map((file) => file.path),
    excludedFiles: state.contextSelection.excludedFiles.map((file) => file.path),
    summary: state.contextSelection.contextSummary
  });
  for (const file of state.contextSelection.selectedFiles) {
    ledger.append({ type: "file_read", phase: "exploration", role: "explorer", path: file.path, reason: file.reason, risk: file.risk });
  }

  const coder = new CoderAgent();
  state.candidates.push(await runAgentState(state, ledger, router, "coder_a", () => coder.run({ plan: state.plan!, contextSelection: state.contextSelection!, variant: "a", fixtureMode: options.provider === "fixture", fixtureFailingPatch: options.fixtureFailingPatch, visualSpec: state.visualSpec })));
  recordPatchCandidateEvent(ledger, "coder_a", state.candidates[state.candidates.length - 1]);
  if (config.debate.enabled && config.debate.max_candidates > 1) {
    state.candidates.push(await runAgentState(state, ledger, router, "coder_b", () => coder.run({ plan: state.plan!, contextSelection: state.contextSelection!, variant: "b", fixtureMode: options.provider === "fixture", fixtureFailingPatch: options.fixtureFailingPatch, visualSpec: state.visualSpec })));
    recordPatchCandidateEvent(ledger, "coder_b", state.candidates[state.candidates.length - 1]);
  }

  if (options.livePatch && access.cloudAllowed) {
    const livePatchInput = {
      cwd,
      goal,
      config,
      router,
      plan: state.plan!,
      contextSelection: state.contextSelection!,
      visualSpec: state.visualSpec,
      ledger
    };
    const patchPlans = await buildLivePatchPlans(livePatchInput);
    state.budgetStatus = preflightBudget(
      patchPlans.map((plan) => ({ provider: plan.provider, prompt: plan.prompt, maxOutputTokens: plan.maxOutputTokens })),
      config.routing.max_cost_usd
    );
    if (state.budgetStatus.status !== "blocked") {
      const livePatchResult = await runLivePatchCandidates(livePatchInput);
      state.candidates.push(...livePatchResult.candidates);
      for (const candidate of livePatchResult.candidates) recordPatchCandidateEvent(ledger, "coder_a", candidate);
      state.modelNotes.push(...livePatchResult.notes);
      state.usageSummary = summarizeModelUsage(state.modelNotes);
      recordModelNoteEvents(ledger, livePatchResult.notes, state.usageSummary);
    }
  } else if (options.livePatch && !access.cloudAllowed) {
    state.budgetStatus = {
      status: "blocked",
      maxCostUsd: config.routing.max_cost_usd,
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
        reason: `Live patch generation blocked by access mode: ${access.mode}.`
      };
      ledger.append({ type: "autonomy_limit_reached", phase: "coding", status: "blocked_by_budget", reason: state.budgetStatus.reason });
  }

  const reviewer = new ReviewerAgent();
  state.review = await runAgentState(state, ledger, router, "reviewer", () => reviewer.run({ candidates: state.candidates, redTeam: options.redTeamReview }));
  ledger.append({
    type: "review_decision",
    phase: "review",
    role: "reviewer",
    reviewRef: ledger.writeArtifact("reviews", JSON.stringify(state.review, null, 2), "json"),
    recommendation: state.review.overallRecommendation
  });
  state.debateRounds = buildDebateRounds(state.candidates, state.review, config.debate.max_rounds);
  ledger.append({ type: "evidence_update", phase: "review", role: "reviewer", evidence: [`debate rounds=${state.debateRounds.length}`] });

  const judge = new JudgeAgent();
  state.judge = await runAgentState(state, ledger, router, "judge", () => judge.run({ candidates: state.candidates, review: state.review! }));
  ledger.append({
    type: "judge_decision",
    phase: "judge",
    role: "judge",
    decision: state.judge.decision,
    selectedCandidateId: state.judge.selectedCandidateId,
    reason: state.judge.reason,
    confidence: state.judge.confidence,
    decisionRef: ledger.writeArtifact("judge_decisions", JSON.stringify(state.judge, null, 2), "json")
  });

  if (options.liveAdvisory && access.cloudAllowed) {
    const advisoryInput = {
      cwd,
      goal,
      config,
      router,
      plan: state.plan,
      candidates: state.candidates,
      review: state.review,
      visualSpec: state.visualSpec,
      ledger
    };
    const advisoryPlans = buildAdvisoryPlans(advisoryInput);
    state.budgetStatus = preflightBudget(
      advisoryPlans.map((plan) => ({ provider: plan.provider, prompt: plan.prompt, maxOutputTokens: plan.maxOutputTokens })),
      config.routing.max_cost_usd
    );
    if (state.budgetStatus.status !== "blocked") {
      const advisoryNotes = await runLiveAdvisory(advisoryInput);
      state.modelNotes.push(...advisoryNotes);
      state.usageSummary = summarizeModelUsage(state.modelNotes);
      recordModelNoteEvents(ledger, advisoryNotes, state.usageSummary);
    }
  } else if (options.liveAdvisory && !access.cloudAllowed) {
    state.budgetStatus = {
      status: "blocked",
      maxCostUsd: config.routing.max_cost_usd,
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
        reason: `Live advisory blocked by access mode: ${access.mode}.`
      };
      ledger.append({ type: "autonomy_limit_reached", phase: "planning", status: "blocked_by_budget", reason: state.budgetStatus.reason });
  }

  if (state.judge.decision === "select" && state.judge.selectedCandidateId) {
    const selected = state.candidates.find((candidate) => candidate.candidateId === state.judge!.selectedCandidateId);
    if (selected?.unifiedDiff) {
      const diffRef = ledger.writeArtifact("diffs", selected.unifiedDiff);
      try {
        const applyResult = await runAgentState(state, ledger, router, "runner", () => applyUnifiedDiffWithResult(cwd, selected.unifiedDiff, access.patchAllowed && access.patchApproved));
        state.changedFiles = applyResult.changedFiles;
        ledger.append({ type: "patch_apply", phase: "patch", role: "runner", provider: "local_tool", model: "patch", candidateId: selected.candidateId, filesChanged: applyResult.changedFiles, diffRef, undoSnapshotIds: applyResult.undoSnapshotIds, applied: true });
      } catch (error) {
        ledger.append({ type: "patch_apply", phase: "patch", role: "runner", provider: "local_tool", model: "patch", candidateId: selected.candidateId, filesChanged: selected.filesChanged, diffRef, undoSnapshotIds: [], applied: false, error: error instanceof Error ? error.message : String(error) });
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
  let shellRuns = 0;
  let repairAttempts = 0;
  if (state.changedFiles.length && testCommand) {
    try {
      if (!canRunShell(config, shellRuns, ledger)) return finalizeState(state, ledger, router);
      shellRuns += 1;
      const result = await runAgentState(state, ledger, router, "runner", () => runTestCommand(cwd, testCommand, access.shellAllowed && access.shellApproved));
      state.runResults.push(result);
      recordShellRunEvent(ledger, cwd, result);
      if (!result.success && options.repairOnFail) {
        if (!canAttemptRepair(config, repairAttempts, ledger)) return finalizeState(state, ledger, router);
        repairAttempts += 1;
        const repairer = new RepairerAgent();
        const repairCandidate = await runAgentState(state, ledger, router, "repairer", () =>
          repairer.run({ plan: state.plan!, failedRun: result, appliedFiles: state.changedFiles, fixtureMode: options.provider === "fixture" })
        );
        state.repairCandidates.push(repairCandidate);
        recordPatchCandidateEvent(ledger, "repairer", repairCandidate);
        const repairDiffRef = repairCandidate.unifiedDiff ? ledger.writeArtifact("diffs", repairCandidate.unifiedDiff) : undefined;
        ledger.append({ type: "repair_attempt", phase: "repair", role: "repairer", candidateId: repairCandidate.candidateId, filesChanged: repairCandidate.filesChanged, diffRef: repairDiffRef });
        if (repairCandidate.unifiedDiff) {
          try {
            const repairApplyResult = await runAgentState(state, ledger, router, "runner", () => applyUnifiedDiffWithResult(cwd, repairCandidate.unifiedDiff, access.repairAllowed && access.repairApproved));
            state.changedFiles = [...new Set([...state.changedFiles, ...repairApplyResult.changedFiles])];
            ledger.append({ type: "patch_apply", phase: "repair", role: "runner", provider: "local_tool", model: "patch", candidateId: repairCandidate.candidateId, filesChanged: repairApplyResult.changedFiles, diffRef: repairDiffRef ?? ledger.writeArtifact("diffs", repairCandidate.unifiedDiff), undoSnapshotIds: repairApplyResult.undoSnapshotIds, applied: true });
            if (!canRunShell(config, shellRuns, ledger)) return finalizeState(state, ledger, router);
            shellRuns += 1;
            const repairedRun = await runAgentState(state, ledger, router, "runner", () => runTestCommand(cwd, testCommand, access.shellAllowed && access.shellApproved));
            state.runResults.push(repairedRun);
            recordShellRunEvent(ledger, cwd, repairedRun);
          } catch (error) {
            ledger.append({ type: "repair_attempt", phase: "repair", role: "repairer", candidateId: repairCandidate.candidateId, filesChanged: repairCandidate.filesChanged, diffRef: repairDiffRef, applied: false, error: error instanceof Error ? error.message : String(error) });
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
      ledger.append({ type: "shell_run", phase: "shell", role: "runner", provider: "local_tool", model: "shell", command: testCommand, cwd, error: error instanceof Error ? error.message : String(error) });
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

  return finalizeState(state, ledger, router);
}

async function finalizeState(state: AgentGraphState, ledger: EventLedger, router: ModelRouter): Promise<AgentGraphState> {
  const summarizer = new SummarizerAgent();
  state.finalSummary = await runAgentState(state, ledger, router, "summarizer", () =>
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
  ledger.append({
    type: "summary",
    phase: "summary",
    role: "summarizer",
    summaryRef: ledger.writeArtifact("summaries", JSON.stringify(state.finalSummary, null, 2), "json"),
    result: state.finalSummary.result
  });

  return state;
}

async function runAgentState<T>(state: AgentGraphState, ledger: EventLedger, router: ModelRouter, role: AgentRole, fn: () => Promise<T>): Promise<T> {
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
    if (assignment.provider !== "local_tool") {
      ledger.append({
        type: "model_call",
        phase: phaseForRole(role),
        role,
        provider: assignment.provider,
        model: assignment.model,
        requestId: agentState.id,
        responseRef: ledger.writeArtifact("responses", JSON.stringify(result, null, 2), "json")
      });
    }
    return result;
  } catch (error) {
    agentState.status = "failed";
    agentState.summary = error instanceof Error ? error.message : String(error);
    updateCapabilityStep(state, role, "blocked", agentState.summary);
    if (assignment.provider !== "local_tool") {
      ledger.append({
        type: "model_call",
        phase: phaseForRole(role),
        role,
        provider: assignment.provider,
        model: assignment.model,
        requestId: agentState.id,
        error: agentState.summary
      });
    }
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

function recordPatchCandidateEvent(ledger: EventLedger, role: AgentRole, candidate: PatchCandidate): void {
  ledger.append({
    type: "patch_candidate",
    phase: role === "repairer" ? "repair" : "coding",
    role,
    candidateId: candidate.candidateId,
    approach: candidate.approach,
    summary: candidate.summary,
    filesChanged: candidate.filesChanged,
    diffRef: candidate.unifiedDiff ? ledger.writeArtifact("diffs", candidate.unifiedDiff) : undefined,
    estimatedRisk: candidate.estimatedRisk
  });
}

function recordShellRunEvent(ledger: EventLedger, cwd: string, result: RunResult): void {
  ledger.append({
    type: "shell_run",
    phase: "shell",
    role: "runner",
    provider: "local_tool",
    model: "shell",
    command: result.command,
    cwd,
    exitCode: result.exitCode,
    stdoutRef: ledger.writeArtifact("stdout", result.stdout),
    stderrRef: ledger.writeArtifact("stderr", result.stderr),
    durationMs: result.durationMs,
    success: result.success
  });
}

function recordModelNoteEvents(ledger: EventLedger, notes: ModelNote[], usageSummary: AgentGraphState["usageSummary"]): void {
  for (const note of notes) {
    ledger.append({
      type: "model_call",
      phase: phaseForRole(note.role),
      role: note.role,
      provider: note.provider,
      model: note.model,
      requestId: note.id,
      responseRef: ledger.writeArtifact("responses", note.content),
      inputTokens: note.usage?.inputTokens,
      outputTokens: note.usage?.outputTokens,
      estimatedCostUsd: note.estimatedCostUsd,
      fallbackUsed: note.fallbackUsed,
      fallbackFrom: note.fallbackFrom ? `${note.fallbackFrom.provider}/${note.fallbackFrom.model}` : undefined,
      error: note.error
    });
  }
  ledger.append({
    type: "cost_usage",
    phase: "routing",
    inputTokens: usageSummary.inputTokens,
    outputTokens: usageSummary.outputTokens,
    totalTokens: usageSummary.totalTokens,
    estimatedCostUsd: usageSummary.estimatedCostUsd
  });
}

function canRunShell(config: TomorrowEdgeConfig, shellRuns: number, ledger: EventLedger): boolean {
  if (shellRuns < config.autonomy.max_shell_runs) return true;
  ledger.append({ type: "autonomy_limit_reached", phase: "shell", status: "blocked_by_iteration_limit", reason: `max_shell_runs=${config.autonomy.max_shell_runs} reached` });
  return false;
}

function canAttemptRepair(config: TomorrowEdgeConfig, repairs: number, ledger: EventLedger): boolean {
  if (repairs < config.autonomy.max_repairs) return true;
  ledger.append({ type: "autonomy_limit_reached", phase: "repair", status: "blocked_by_iteration_limit", reason: `max_repairs=${config.autonomy.max_repairs} reached` });
  return false;
}

function phaseForRole(role: AgentRole) {
  if (role === "vision") return "vision";
  if (role === "planner") return "planning";
  if (role === "explorer") return "exploration";
  if (role === "reviewer") return "review";
  if (role === "judge") return "judge";
  if (role === "repairer") return "repair";
  if (role === "summarizer") return "summary";
  if (role === "runner") return "shell";
  return "coding";
}

function accessModeDescription(mode: AccessMode): string {
  if (mode === "full") return "MODE: FULL AUTONOMY - every step is visible and logged.";
  if (mode === "restricted") return "MODE: RESTRICTED - offline/read-only.";
  return "MODE: PARTIAL SUPERVISION - patch/shell/repair require approval.";
}
