import { existsSync } from "node:fs";
import path from "node:path";
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
import { buildAccessPolicy, describeAccessPolicy } from "../permissions/accessPolicy.js";
import { buildLivePatchPlans, runLivePatchCandidates } from "../model/livePatchGenerator.js";
import { buildVisionCostPrompt, estimateVisionInputTokens, runLiveVisionSpec } from "../model/liveVisionSpec.js";
import { buildDebateRounds } from "../debate/debateEngine.js";
import { buildCapabilityRoute } from "../capabilities/capabilityStitching.js";
import { createEventLedger, type EventLedger } from "../events/eventLedger.js";
import type { ModelNote } from "../../schemas/modelNote.js";
import type { PatchCandidate } from "../../schemas/patchCandidate.js";
import type { Plan } from "../../schemas/plan.js";
import type { RunResult } from "../../schemas/evidence.js";
import type { JudgeDecision } from "../../schemas/judge.js";
import type { ReviewReport } from "../../schemas/review.js";
import { resolveConversationTarget, targetPromptPrefix } from "../conversation/conversationTargets.js";
import { externalAgentRegistryFromConfig, type ExternalAgentRegistry } from "../externalAgents/externalAgentRegistry.js";
import type { ExternalAgentProfile } from "../externalAgents/externalAgentTypes.js";
import { externalAgentIdFromProvider } from "../externalAgents/externalAgentRouter.js";
import { invokeExternalRole } from "../externalAgents/externalRoleInvoker.js";
import { runtimeArtifactFromText, type RuntimeArtifactKind } from "../contextProjection/artifactView.js";
import { projectRuntimeArtifact, type ProviderView } from "../contextProjection/providerView.js";
import { buildPatchEvidence } from "../evidence/patchEvidence.js";
import { buildTestEvidence } from "../evidence/testEvidence.js";
import { buildReviewEvidence } from "../evidence/reviewEvidence.js";
import { buildJudgeEvidence } from "../evidence/judgeEvidence.js";
import type { EvidencePacket } from "../evidence/evidencePacket.js";
import { computeTraceCompleteness } from "../diagnostics/traceCompleteness.js";
import { buildRoleRoutingDecision } from "../roleRouting/roleRoutingPolicy.js";
import { allocateStrongAgentCall } from "../budget/budgetAllocator.js";
import { isStrongAgentRole } from "../budget/strongAgentBudget.js";

export type OfflineGraphOptions = {
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
  imagePaths?: string[];
  conversationTarget?: string;
};

export async function runOfflineGraph(cwd: string, goal: string, config: TomorrowEdgeConfig, options: OfflineGraphOptions = {}): Promise<AgentGraphState> {
  const router = new ModelRouter(config);
  const externalAgents = externalAgentRegistryFromConfig(config);
  const access = buildAccessPolicy(config, {
    mode: options.accessMode,
    approvePatch: options.approvePatch,
    approveShell: options.approveShell,
    approveRepair: options.approveRepair
  });
  const ledger = createEventLedger(access.mode);
  const startedAtMs = Date.now();
  const conversationTarget = resolveConversationTarget(config, options.conversationTarget);
  const state: AgentGraphState = {
    sessionId: ledger.sessionId,
    goal,
    conversationTarget,
    routing: router.getPlan(),
    access,
    events: ledger.events,
    eventArtifacts: ledger.artifacts,
    providerViews: [],
    evidencePackets: [],
    agents: [],
    candidates: [],
    repairCandidates: [],
    debateRounds: [],
    modelNotes: [],
    usageSummary: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    budgetStatuses: [],
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
    description: describeAccessPolicy(access)
  });
  ledger.append({
    type: "conversation_target",
    phase: "routing",
    target: conversationTarget.id,
    targetKind: conversationTarget.kind,
    label: conversationTarget.label,
    description: conversationTarget.description
  });
  ledger.append({
    type: "conversation_message",
    phase: "routing",
    target: conversationTarget.id,
    targetKind: conversationTarget.kind,
    messageRef: ledger.writeArtifact("conversation_messages", goal),
    summary: `${conversationTarget.id}: ${goal.slice(0, 120)}${goal.length > 120 ? "..." : ""}`
  });
  ledger.append({
    type: "evidence_update",
    phase: "routing",
    evidence: [`routing mode=${state.routing.mode}`, `access mode=${state.access.mode}`, `assignments=${state.routing.assignments.length}`]
  });
  let strongAgentCallsUsed = 0;
  for (const assignment of state.routing.assignments) {
    const decision = buildRoleRoutingDecision(config, assignment);
    const budgetDecision = allocateStrongAgentCall(assignment.role, strongAgentCallsUsed, {
      maxCallsPerTask: config.strong_agents.max_calls_per_task,
      maxCostUsd: config.strong_agents.max_cost_usd,
      reserveForRoles: config.strong_agents.reserve_for_roles,
      escalateOn: config.strong_agents.escalate_on
    });
    if (isStrongAgentRole(assignment.role)) strongAgentCallsUsed += 1;
    ledger.append({
      type: "routing_decision",
      phase: "routing",
      role: assignment.role,
      provider: assignment.provider,
      model: assignment.model,
      assignedRole: decision.role,
      assignedProvider: decision.provider,
      assignedModel: decision.model,
      reason: decision.reason,
      policyTags: decision.policyTags
    });
    ledger.append({
      type: "budget_decision",
      phase: "routing",
      role: assignment.role,
      provider: assignment.provider,
      model: assignment.model,
      status: budgetDecision.allowed ? "allowed" : "blocked",
      reason: budgetDecision.reason,
      maxCostUsd: config.routing.max_cost_usd,
      strongAgentCallsUsed,
      strongAgentCallsRemaining: budgetDecision.remainingCalls
    });
  }

  const imagePaths = validateImagePaths(cwd, options.imagePaths ?? []);
  state.capabilityRoute = buildCapabilityRoute({ goal, imagePaths, router });
  const externalCore = externalProfileForRole(router, externalAgents, "core");
  if (externalCore) {
    const coreResult = await runAgentState(state, ledger, router, "core", () =>
      invokeExternalRole({
        cwd,
        profile: externalCore,
        role: "core",
        prompt: `Act as TomorrowEdge Core. Plan and supervise this workflow: ${goal}`,
        context: { goal, routing: state.routing, access: state.access, conversationTarget },
        ledger
      }),
      "external"
    );
    const corePlan = normalizeExternalPlan(coreResult.payload, goal);
    if (corePlan) state.plan = corePlan;
    else recordExternalNormalizeFallback(ledger, "core", externalCore, "plan", "native planner");
    ledger.append({
      type: "evidence_update",
      phase: "planning",
      role: "core",
      evidence: [coreResult.summary],
      evidenceRef: ledger.writeArtifact("summaries", JSON.stringify(coreResult.payload, null, 2), "json")
    });
  }
  if (imagePaths.length) {
    const vision = new VisionAgent();
    if (options.liveVision && access.cloudAllowed) {
      const assignment = router.assignmentFor("vision");
      const budgetStatus = setBudgetStatus(state, preflightBudget(
        [{ provider: assignment.provider, prompt: buildVisionCostPrompt(goal, imagePaths), estimatedInputTokens: estimateVisionInputTokens(goal, imagePaths), maxOutputTokens: 1200 }],
        config.routing.max_cost_usd
      ));
      if (budgetStatus.status !== "blocked") {
        const liveVision = await runAgentState(state, ledger, router, "vision", () => runLiveVisionSpec({ goal, imagePaths, config, router, ledger }), "live");
        state.modelNotes.push(liveVision.note);
        state.usageSummary = summarizeModelUsage(state.modelNotes);
        recordModelNoteEvents(ledger, [liveVision.note], state.usageSummary);
        state.visualSpec = liveVision.spec;
      }
    } else if (options.liveVision && !access.cloudAllowed) {
      const budgetStatus = setBudgetStatus(state, {
        status: "blocked",
        maxCostUsd: config.routing.max_cost_usd,
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0,
        reason: `Live vision blocked by access mode: ${access.mode}.`
      });
      ledger.append({ type: "autonomy_limit_reached", phase: "vision", status: "blocked_by_budget", reason: budgetStatus.reason });
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
  const plannerGoal = [targetPromptPrefix(conversationTarget), goal, state.visualSpec?.handoffPrompt].filter(Boolean).join("\n\n");
  const externalPlanner = externalProfileForRole(router, externalAgents, "planner");
  state.plan = state.plan ?? await runAgentState(state, ledger, router, "planner", async () => {
    if (!externalPlanner) return planner.run({ goal: plannerGoal });
    const result = await invokeExternalRole({
      cwd,
      profile: externalPlanner,
      role: "planner",
      prompt: `Create a TomorrowEdge plan for this goal: ${plannerGoal}`,
      context: { goal: plannerGoal, visualSpec: state.visualSpec, routing: state.routing },
      ledger
    });
    const plan = normalizeExternalPlan(result.payload, goal);
    if (!plan) recordExternalNormalizeFallback(ledger, "planner", externalPlanner, "plan", "native planner");
    return plan ?? planner.run({ goal: plannerGoal });
  }, externalPlanner ? "external" : "offline");
  state.plan = { ...(state.plan ?? { steps: [], constraints: [], riskLevel: "low" as const, taskType: "test" as const, verificationCommands: [], debateRecommended: false }), goal };
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
  state.candidates.push(await runCoderCandidate({ cwd, state, ledger, router, externalAgents, coder, role: "coder_a", variant: "a", options }));
  recordPatchCandidateEvent(state, ledger, "coder_a", state.candidates[state.candidates.length - 1]);
  if (config.debate.enabled && config.debate.max_candidates > 1) {
    state.candidates.push(await runCoderCandidate({ cwd, state, ledger, router, externalAgents, coder, role: "coder_b", variant: "b", options }));
    recordPatchCandidateEvent(state, ledger, "coder_b", state.candidates[state.candidates.length - 1]);
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
    const budgetStatus = setBudgetStatus(state, preflightBudget(
      patchPlans.map((plan) => ({ provider: plan.provider, prompt: plan.prompt, maxOutputTokens: plan.maxOutputTokens })),
      config.routing.max_cost_usd
    ));
    if (budgetStatus.status !== "blocked") {
      const livePatchResult = await runLivePatchCandidates(livePatchInput);
      state.candidates.push(...livePatchResult.candidates);
      for (const candidate of livePatchResult.candidates) recordPatchCandidateEvent(state, ledger, candidate.agentId as AgentRole, candidate);
      state.modelNotes.push(...livePatchResult.notes);
      state.usageSummary = summarizeModelUsage(state.modelNotes);
      recordModelNoteEvents(ledger, livePatchResult.notes, state.usageSummary);
    }
  } else if (options.livePatch && !access.cloudAllowed) {
    const budgetStatus = setBudgetStatus(state, {
      status: "blocked",
      maxCostUsd: config.routing.max_cost_usd,
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
        reason: `Live patch generation blocked by access mode: ${access.mode}.`
      });
      ledger.append({ type: "autonomy_limit_reached", phase: "coding", status: "blocked_by_budget", reason: budgetStatus.reason });
  }

  const reviewer = new ReviewerAgent();
  const externalReviewer = externalProfileForRole(router, externalAgents, "reviewer");
  state.review = await runAgentState(state, ledger, router, "reviewer", async () => {
    if (!externalReviewer) return reviewer.run({ candidates: state.candidates, evidencePackets: state.evidencePackets, redTeam: options.redTeamReview });
    const result = await invokeExternalRole({
      cwd,
      profile: externalReviewer,
      role: "reviewer",
      prompt: "Review the current patch candidates and return a TomorrowEdge review report.",
      context: { candidates: state.candidates, evidencePackets: state.evidencePackets, redTeam: options.redTeamReview },
      ledger
    });
    const review = normalizeExternalReview(result.payload);
    if (!review) recordExternalNormalizeFallback(ledger, "reviewer", externalReviewer, "review", "native reviewer");
    return review ?? reviewer.run({ candidates: state.candidates, evidencePackets: state.evidencePackets, redTeam: options.redTeamReview });
  }, externalReviewer ? "external" : "offline");
  const reviewJson = JSON.stringify(state.review, null, 2);
  const reviewRef = ledger.writeArtifact("reviews", reviewJson, "json");
  recordArtifactProjection(state, ledger, "review", reviewRef, reviewJson, "review", "reviewer");
  recordEvidencePacket(state, ledger, buildReviewEvidence(state.review, reviewRef), "reviewer");
  ledger.append({
    type: "review_decision",
    phase: "review",
    role: "reviewer",
    reviewRef,
    recommendation: state.review.overallRecommendation
  });
  state.debateRounds = buildDebateRounds(state.candidates, state.review, config.debate.max_rounds);
  ledger.append({ type: "evidence_update", phase: "review", role: "reviewer", evidence: [`debate rounds=${state.debateRounds.length}`] });

  const judge = new JudgeAgent();
  const externalJudge = externalProfileForRole(router, externalAgents, "judge");
  state.judge = await runAgentState(state, ledger, router, "judge", async () => {
    if (!externalJudge) return judge.run({ candidates: state.candidates, review: state.review!, evidencePackets: state.evidencePackets });
    const result = await invokeExternalRole({
      cwd,
      profile: externalJudge,
      role: "judge",
      prompt: "Judge the reviewed candidates and return a TomorrowEdge judge decision.",
      context: { candidates: state.candidates, review: state.review, evidencePackets: state.evidencePackets },
      ledger
    });
    const judgment = normalizeExternalJudgment(result.payload);
    if (!judgment) recordExternalNormalizeFallback(ledger, "judge", externalJudge, "judgment", "native judge");
    return judgment ?? judge.run({ candidates: state.candidates, review: state.review!, evidencePackets: state.evidencePackets });
  }, externalJudge ? "external" : "offline");
  const judgeJson = JSON.stringify(state.judge, null, 2);
  const decisionRef = ledger.writeArtifact("judge_decisions", judgeJson, "json");
  recordArtifactProjection(state, ledger, "judge", decisionRef, judgeJson, "judge", "judge");
  recordEvidencePacket(state, ledger, buildJudgeEvidence(state.judge, decisionRef), "judge");
  ledger.append({
    type: "judge_decision",
    phase: "judge",
    role: "judge",
    decision: state.judge.decision,
    selectedCandidateId: state.judge.selectedCandidateId,
    reason: state.judge.reason,
    confidence: state.judge.confidence,
    decisionRef
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
    const budgetStatus = setBudgetStatus(state, preflightBudget(
      advisoryPlans.map((plan) => ({ provider: plan.provider, prompt: plan.prompt, maxOutputTokens: plan.maxOutputTokens })),
      config.routing.max_cost_usd
    ));
    if (budgetStatus.status !== "blocked") {
      const advisoryNotes = await runLiveAdvisory(advisoryInput);
      state.modelNotes.push(...advisoryNotes);
      state.usageSummary = summarizeModelUsage(state.modelNotes);
      recordModelNoteEvents(ledger, advisoryNotes, state.usageSummary);
    }
  } else if (options.liveAdvisory && !access.cloudAllowed) {
    const budgetStatus = setBudgetStatus(state, {
      status: "blocked",
      maxCostUsd: config.routing.max_cost_usd,
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
        reason: `Live advisory blocked by access mode: ${access.mode}.`
      });
      ledger.append({ type: "autonomy_limit_reached", phase: "planning", status: "blocked_by_budget", reason: budgetStatus.reason });
  }

  if (state.judge?.decision === "select" && state.judge.selectedCandidateId) {
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
    } else {
      const reason = selected
        ? `Judge selected candidate ${selected.candidateId} but it has no unified diff to apply.`
        : `Judge selected candidate ${state.judge.selectedCandidateId} but it was not found in the candidate list.`;
      ledger.append({ type: "patch_apply", phase: "patch", role: "runner", provider: "local_tool", model: "patch", candidateId: state.judge.selectedCandidateId, filesChanged: [], diffRef: undefined, undoSnapshotIds: [], applied: false, error: reason });
    }
  }

  const testCommands = options.testCommand ? [options.testCommand] : state.plan.verificationCommands ?? [];
  let shellRuns = 0;
  let repairAttempts = 0;
  if (state.changedFiles.length && testCommands.length) {
    try {
      for (const testCommand of testCommands) {
        if (!canContinueAutonomy(config, state, ledger, startedAtMs, "shell")) return finalizeState(state, ledger, router);
        if (!canRunShell(config, shellRuns, ledger)) return finalizeState(state, ledger, router);
        shellRuns += 1;
        const result = await runAgentState(state, ledger, router, "runner", () => runTestCommand(cwd, testCommand, shellExecutionOptions(config, access)));
        state.runResults.push(result);
        recordShellRunEvent(state, ledger, cwd, result);
        if (result.success) continue;
        if (!options.repairOnFail) break;
        if (!canContinueAutonomy(config, state, ledger, startedAtMs, "repair")) return finalizeState(state, ledger, router);
        if (!canAttemptRepair(config, repairAttempts, ledger)) return finalizeState(state, ledger, router);
        repairAttempts += 1;
        const repairer = new RepairerAgent();
        const externalRepairer = externalProfileForRole(router, externalAgents, "repairer");
        const repairCandidate = await runAgentState(state, ledger, router, "repairer", async () => {
          if (!externalRepairer) return repairer.run({ plan: state.plan!, failedRun: result, appliedFiles: state.changedFiles, fixtureMode: (options.provider === "fixture" || options.fixtureMode) });
          const externalResult = await invokeExternalRole({
            cwd,
            profile: externalRepairer,
            role: "repairer",
            prompt: "Repair the failed test run and return a TomorrowEdge patch candidate.",
            context: { plan: state.plan, failedRun: result, appliedFiles: state.changedFiles },
            ledger
          });
          const patch = normalizeExternalPatch(externalResult.payload, "repairer", "repair");
          if (!patch) recordExternalNormalizeFallback(ledger, "repairer", externalRepairer, "patch candidate", "native repairer");
          return patch ?? repairer.run({ plan: state.plan!, failedRun: result, appliedFiles: state.changedFiles, fixtureMode: (options.provider === "fixture" || options.fixtureMode) });
        }, externalRepairer ? "external" : "offline");
        state.repairCandidates.push(repairCandidate);
        recordPatchCandidateEvent(state, ledger, "repairer", repairCandidate);
        const repairDiffRef = repairCandidate.unifiedDiff ? ledger.writeArtifact("diffs", repairCandidate.unifiedDiff) : undefined;
        ledger.append({ type: "repair_attempt", phase: "repair", role: "repairer", candidateId: repairCandidate.candidateId, filesChanged: repairCandidate.filesChanged, diffRef: repairDiffRef });
        if (repairCandidate.unifiedDiff) {
          try {
            const repairApplyResult = await runAgentState(state, ledger, router, "runner", () => applyUnifiedDiffWithResult(cwd, repairCandidate.unifiedDiff, access.repairAllowed && access.repairApproved));
            state.changedFiles = [...new Set([...state.changedFiles, ...repairApplyResult.changedFiles])];
            ledger.append({ type: "patch_apply", phase: "repair", role: "runner", provider: "local_tool", model: "patch", candidateId: repairCandidate.candidateId, filesChanged: repairApplyResult.changedFiles, diffRef: repairDiffRef ?? ledger.writeArtifact("diffs", repairCandidate.unifiedDiff), undoSnapshotIds: repairApplyResult.undoSnapshotIds, applied: true });
            if (!canContinueAutonomy(config, state, ledger, startedAtMs, "shell")) return finalizeState(state, ledger, router);
            if (!canRunShell(config, shellRuns, ledger)) return finalizeState(state, ledger, router);
            shellRuns += 1;
            const repairedRun = await runAgentState(state, ledger, router, "runner", () => runTestCommand(cwd, testCommand, shellExecutionOptions(config, access)));
            state.runResults.push(repairedRun);
            recordShellRunEvent(state, ledger, cwd, repairedRun);
            if (!repairedRun.success) break;
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
      ledger.append({ type: "shell_run", phase: "shell", role: "runner", provider: "local_tool", model: "shell", command: testCommands.join(" && "), cwd, error: error instanceof Error ? error.message : String(error) });
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

async function runCoderCandidate(input: {
  cwd: string;
  state: AgentGraphState;
  ledger: EventLedger;
  router: ModelRouter;
  externalAgents: ExternalAgentRegistry;
  coder: CoderAgent;
  role: "coder_a" | "coder_b";
  variant: "a" | "b";
  options: OfflineGraphOptions;
}): Promise<PatchCandidate> {
  const externalCoder = externalProfileForRole(input.router, input.externalAgents, input.role);
  return runAgentState(input.state, input.ledger, input.router, input.role, async () => {
    const fallback = () => input.coder.run({
      plan: input.state.plan!,
      contextSelection: input.state.contextSelection!,
      variant: input.variant,
      fixtureMode: input.options.provider === "fixture" || input.options.fixtureMode,
      fixtureFailingPatch: input.options.fixtureFailingPatch,
      visualSpec: input.state.visualSpec
    });
    if (!externalCoder) return fallback();
    const result = await invokeExternalRole({
      cwd: input.cwd,
      profile: externalCoder,
      role: input.role,
      prompt: `Create a TomorrowEdge patch candidate for ${input.role}.`,
      context: {
        plan: input.state.plan,
        contextSelection: input.state.contextSelection,
        visualSpec: input.state.visualSpec,
        variant: input.variant
      },
      ledger: input.ledger
    });
    const patch = normalizeExternalPatch(result.payload, input.role, input.variant === "a" ? "minimal_patch" : "alternative");
    if (!patch) recordExternalNormalizeFallback(input.ledger, input.role, externalCoder, "patch candidate", `native ${input.role}`);
    return patch ?? fallback();
  }, externalCoder ? "external" : "offline");
}

function recordExternalNormalizeFallback(ledger: EventLedger, role: AgentRole, profile: ExternalAgentProfile, expected: string, fallback: string): void {
  ledger.append({
    type: "external_agent_error",
    phase: phaseForRole(role),
    role,
    provider: `external:${profile.id}`,
    model: profile.name,
    externalAgentId: profile.id,
    error: `External ${role} result was unparseable as ${expected}; falling back to ${fallback}.`
  });
  ledger.append({
    type: "fallback_to_native",
    phase: phaseForRole(role),
    role,
    provider: `external:${profile.id}`,
    model: profile.name,
    externalAgentId: profile.id,
    fallbackRole: role,
    reason: `External ${role} result was unparseable as ${expected}; using ${fallback}.`
  });
}

function externalProfileForRole(router: ModelRouter, registry: ExternalAgentRegistry, role: AgentRole): ExternalAgentProfile | undefined {
  const assignment = router.getPlan().assignments.find((item) => item.role === role);
  const externalAgentId = assignment ? externalAgentIdFromProvider(assignment.provider) : undefined;
  if (!externalAgentId) return undefined;
  return registry.get(externalAgentId);
}

function normalizeExternalPlan(payload: unknown, goal: string): Plan | undefined {
  const source = unwrapNamed(payload, "plan");
  const object = asRecord(source);
  const steps = Array.isArray(object?.steps) ? object.steps.map(normalizePlanStep).filter((step): step is Plan["steps"][number] => Boolean(step)) : undefined;
  if (!object || !steps?.length) return undefined;
  return {
    goal: stringOr(object.goal, goal),
    constraints: stringArray(object.constraints),
    riskLevel: riskLevel(object.riskLevel),
    taskType: taskType(object.taskType),
    steps,
    expectedFiles: stringArray(object.expectedFiles),
    verificationCommands: stringArray(object.verificationCommands),
    debateRecommended: typeof object.debateRecommended === "boolean" ? object.debateRecommended : steps.length > 1,
    reasonForDebate: typeof object.reasonForDebate === "string" ? object.reasonForDebate : undefined
  };
}

function normalizeExternalPatch(payload: unknown, agentId: string, approach: PatchCandidate["approach"]): PatchCandidate | undefined {
  const source = unwrapNamed(payload, "candidate");
  const object = asRecord(source);
  if (!object) return undefined;
  const summary = typeof object.summary === "string" ? object.summary : "";
  const unifiedDiff = typeof object.unifiedDiff === "string" ? object.unifiedDiff : "";
  if (!summary && !unifiedDiff) return undefined;
  return {
    candidateId: stringOr(object.candidateId, `${agentId}_external_candidate`),
    agentId: stringOr(object.agentId, agentId),
    approach: patchApproach(object.approach, approach),
    summary: summary || `External ${agentId} patch candidate.`,
    filesChanged: stringArray(object.filesChanged),
    unifiedDiff,
    testPlan: stringArray(object.testPlan),
    knownTradeoffs: stringArray(object.knownTradeoffs),
    estimatedRisk: riskLevel(object.estimatedRisk)
  };
}

function normalizeExternalReview(payload: unknown): ReviewReport | undefined {
  const source = unwrapNamed(payload, "review");
  const object = asRecord(source);
  if (!object || !Array.isArray(object.reviews)) return undefined;
  const reviews = object.reviews.map(normalizeCandidateReview).filter((review): review is ReviewReport["reviews"][number] => Boolean(review));
  if (!reviews.length) return undefined;
  return {
    mode: object.mode === "red_team" ? "red_team" : "standard",
    reviews,
    overallRecommendation: stringOr(object.overallRecommendation, "External review completed.")
  };
}

function normalizeExternalJudgment(payload: unknown): JudgeDecision | undefined {
  const source = unwrapNamed(payload, "judgment");
  const object = asRecord(source);
  if (!object) return undefined;
  const decision = ["select", "request_revision", "ask_user", "abort"].includes(String(object.decision)) ? object.decision as JudgeDecision["decision"] : undefined;
  if (!decision) return undefined;
  return {
    selectedCandidateId: typeof object.selectedCandidateId === "string" ? object.selectedCandidateId : undefined,
    decision,
    reason: stringOr(object.reason, "External judge returned a decision."),
    borrowIdeasFromOtherCandidates: stringArray(object.borrowIdeasFromOtherCandidates),
    confidence: boundedNumber(object.confidence, 0.7),
    requiredUserDecision: typeof object.requiredUserDecision === "string" ? object.requiredUserDecision : undefined
  };
}

function normalizePlanStep(value: unknown): Plan["steps"][number] | undefined {
  const object = asRecord(value);
  if (!object) return undefined;
  const title = typeof object.title === "string" ? object.title : "";
  if (!title) return undefined;
  const status = ["pending", "running", "done", "blocked"].includes(String(object.status)) ? object.status as Plan["steps"][number]["status"] : "pending";
  return {
    id: stringOr(object.id, title.toLowerCase().replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "step"),
    title,
    detail: stringOr(object.detail, title),
    status
  };
}

function normalizeCandidateReview(value: unknown): ReviewReport["reviews"][number] | undefined {
  const object = asRecord(value);
  if (!object || typeof object.candidateId !== "string") return undefined;
  const recommendation = ["accept", "accept_with_minor_change", "revise", "reject"].includes(String(object.recommendation)) ? object.recommendation as ReviewReport["reviews"][number]["recommendation"] : "revise";
  const invasiveness = ["low", "medium", "high"].includes(String(object.invasiveness)) ? object.invasiveness as ReviewReport["reviews"][number]["invasiveness"] : "medium";
  const testCoverage = ["none", "weak", "adequate", "strong"].includes(String(object.testCoverage)) ? object.testCoverage as ReviewReport["reviews"][number]["testCoverage"] : "weak";
  return {
    candidateId: object.candidateId,
    correctnessScore: boundedNumber(object.correctnessScore, 50),
    riskScore: boundedNumber(object.riskScore, 50),
    invasiveness,
    testCoverage,
    securityConcerns: stringArray(object.securityConcerns),
    regressionConcerns: stringArray(object.regressionConcerns),
    redTeamFindings: [],
    recommendation,
    notes: stringArray(object.notes)
  };
}

function unwrapNamed(payload: unknown, key: string): unknown {
  const object = asRecord(payload);
  if (object?.payload !== undefined) return unwrapNamed(object.payload, key);
  return object && object[key] !== undefined ? object[key] : payload;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" && value.trim() ? [value] : [];
}

function boundedNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback;
}

function riskLevel(value: unknown): Plan["riskLevel"] {
  return value === "medium" || value === "high" ? value : "low";
}

function taskType(value: unknown): Plan["taskType"] {
  return ["bugfix", "feature", "refactor", "test", "docs", "analysis", "unknown"].includes(String(value)) ? value as Plan["taskType"] : "unknown";
}

function patchApproach(value: unknown, fallback: PatchCandidate["approach"]): PatchCandidate["approach"] {
  return ["minimal_patch", "refactor", "test_first", "alternative", "repair"].includes(String(value)) ? value as PatchCandidate["approach"] : fallback;
}

function validateImagePaths(cwd: string, imagePaths: string[]): string[] {
  return imagePaths.map((imagePath) => {
    const resolved = path.isAbsolute(imagePath) ? imagePath : path.resolve(cwd, imagePath);
    if (!existsSync(resolved)) {
      throw new Error(`Image input not found: ${imagePath}`);
    }
    return resolved;
  });
}

async function finalizeState(state: AgentGraphState, ledger: EventLedger, router: ModelRouter): Promise<AgentGraphState> {
  const summarizer = new SummarizerAgent();
  try {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.finalSummary = {
      task: state.goal,
      result: state.runResults.some((result) => !result.success) ? "partially_completed" : "completed",
      changedFiles: state.changedFiles,
      testsRun: state.runResults.map((result) => result.command),
      evidence: ["summarizer failed; fallback summary generated", ...state.runResults.map(evidenceFromRun)],
      risksRemaining: [`summarizer failed: ${message}`],
      suggestedCommitMessage: `chore: update ${state.changedFiles[0] ?? "workspace"}`
    };
  }
  ledger.append({
    type: "summary",
    phase: "summary",
    role: "summarizer",
    summaryRef: ledger.writeArtifact("summaries", JSON.stringify(state.finalSummary, null, 2), "json"),
    result: state.finalSummary.result
  });
  ledger.append({
    type: "workflow_stop_reason",
    phase: "summary",
    role: "summarizer",
    reason: workflowStopReason(state),
    result: state.finalSummary.result
  });
  state.traceCompleteness = computeTraceCompleteness(ledger.events);
  ledger.append({
    type: "trace_completeness",
    phase: "summary",
    role: "summarizer",
    score: state.traceCompleteness.score,
    missing: state.traceCompleteness.missing
  });

  return state;
}

function workflowStopReason(state: AgentGraphState): string {
  if (state.judge?.decision === "abort") return "judge aborted workflow";
  if (state.judge?.decision === "ask_user") return "judge requested user decision";
  const latestRun = state.runResults.at(-1);
  if (latestRun && !latestRun.success) return "verification failed or repair budget ended";
  if (latestRun?.success && state.repairCandidates.length) return "repair applied and verification passed";
  if (state.changedFiles.length) return "selected patch applied and workflow finalized";
  return "no patch applied; workflow finalized after review and judge";
}

async function runAgentState<T>(state: AgentGraphState, ledger: EventLedger, router: ModelRouter, role: AgentRole, fn: () => Promise<T>, agentKind: AgentRunState["agentKind"] = "offline"): Promise<T> {
  const assignment = router.assignmentFor(role);
  const agentState: AgentRunState = {
    id: role,
    role,
    provider: assignment.provider,
    model: assignment.model,
    status: "running",
    agentKind,
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
        type: "agent_run",
        phase: phaseForRole(role),
        role,
        provider: assignment.provider,
        model: assignment.model,
        status: "success",
        runId: agentState.id,
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
        type: "agent_run",
        phase: phaseForRole(role),
        role,
        provider: assignment.provider,
        model: assignment.model,
        status: "failure",
        runId: agentState.id,
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

function recordPatchCandidateEvent(state: AgentGraphState, ledger: EventLedger, role: AgentRole, candidate: PatchCandidate): void {
  const diffRef = candidate.unifiedDiff ? ledger.writeArtifact("diffs", candidate.unifiedDiff) : undefined;
  const phase = role === "repairer" ? "repair" : "coding";
  if (diffRef) recordArtifactProjection(state, ledger, phase, diffRef, candidate.unifiedDiff, "diff", role);
  recordEvidencePacket(state, ledger, buildPatchEvidence(candidate, diffRef), role);
  ledger.append({
    type: "patch_candidate",
    phase,
    role,
    candidateId: candidate.candidateId,
    approach: candidate.approach,
    summary: candidate.summary,
    filesChanged: candidate.filesChanged,
    diffRef,
    estimatedRisk: candidate.estimatedRisk
  });
}

function recordShellRunEvent(state: AgentGraphState, ledger: EventLedger, cwd: string, result: RunResult): void {
  const stdoutRef = ledger.writeArtifact("stdout", result.stdout);
  const stderrRef = ledger.writeArtifact("stderr", result.stderr);
  recordArtifactProjection(state, ledger, "shell", stdoutRef, result.stdout, "stdout", "runner");
  recordArtifactProjection(state, ledger, "shell", stderrRef, result.stderr, "stderr", "runner");
  recordEvidencePacket(state, ledger, buildTestEvidence(result, { stdoutRef, stderrRef }), "runner");
  ledger.append({
    type: "shell_run",
    phase: "shell",
    role: "runner",
    provider: "local_tool",
    model: "shell",
    command: result.command,
    cwd,
    exitCode: result.exitCode,
    stdoutRef,
    stderrRef,
    durationMs: result.durationMs,
    success: result.success
  });
}

function recordArtifactProjection(state: AgentGraphState, ledger: EventLedger, phase: TomorrowEdgeProjectionPhase, artifactRef: string, content: string, kind: RuntimeArtifactKind, role?: AgentRole): ProviderView {
  const view = projectRuntimeArtifact(runtimeArtifactFromText(artifactRef, kind, content));
  const previewRef = ledger.writeArtifact("provider_views", view.preview);
  state.providerViews.push(view);
  ledger.append({
    type: "artifact_projection",
    phase,
    role,
    artifactRef,
    artifactKind: kind,
    previewRef,
    handle: view.handle,
    policy: view.policy,
    omittedBytes: view.omittedBytes,
    tokenEstimate: view.tokenEstimate
  });
  ledger.append({
    type: "context_projection",
    phase,
    role,
    selectedArtifacts: [artifactRef],
    projectedArtifacts: [previewRef],
    tokenEstimate: view.tokenEstimate ?? 0,
    omittedBytes: view.omittedBytes ?? 0,
    policySummary: `${kind}:${view.policy}`
  });
  return view;
}

function recordEvidencePacket(state: AgentGraphState, ledger: EventLedger, packet: EvidencePacket, role?: AgentRole): void {
  state.evidencePackets.push(packet);
  ledger.append({
    type: "evidence_packet",
    phase: packet.phase === "plan" ? "planning" : packet.phase === "patch" ? "coding" : packet.phase === "test" ? "verification" : packet.phase,
    role,
    packetId: packet.id,
    evidencePhase: packet.phase,
    summary: packet.summary,
    verificationStatus: packet.verificationStatus,
    supportingArtifacts: packet.supportingArtifacts,
    packetRef: ledger.writeArtifact("evidence_packets", JSON.stringify(packet, null, 2), "json")
  });
}

type TomorrowEdgeProjectionPhase = "coding" | "review" | "judge" | "shell" | "repair" | "verification";

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

function setBudgetStatus(state: AgentGraphState, status: NonNullable<AgentGraphState["budgetStatus"]>): NonNullable<AgentGraphState["budgetStatus"]> {
  state.budgetStatus = status;
  state.budgetStatuses.push(status);
  return status;
}

function canContinueAutonomy(config: TomorrowEdgeConfig, state: AgentGraphState, ledger: EventLedger, startedAtMs: number, phase: "shell" | "repair" | "summary" | "coding"): boolean {
  const elapsedSec = (Date.now() - startedAtMs) / 1000;
  if (elapsedSec > config.autonomy.max_wall_time_sec) {
    ledger.append({ type: "autonomy_limit_reached", phase, status: "blocked_by_iteration_limit", reason: `max_wall_time_sec=${config.autonomy.max_wall_time_sec} reached` });
    return false;
  }
  const cost = state.usageSummary.estimatedCostUsd;
  if (cost !== undefined && cost > config.autonomy.max_cost_usd) {
    ledger.append({ type: "autonomy_limit_reached", phase, status: "blocked_by_budget", reason: `autonomy.max_cost_usd=${config.autonomy.max_cost_usd} exceeded by estimated cost $${cost.toFixed(6)}` });
    return false;
  }
  return true;
}

function shellExecutionOptions(config: TomorrowEdgeConfig, access: AgentGraphState["access"]) {
  const configuredPolicy = config.shell.policy;
  const policy = configuredPolicy ?? (access.mode === "full" ? "unrestricted" : "approval_required");
  return {
    approved: access.shellAllowed && access.shellApproved,
    policy,
    verificationAllowlist: config.shell.verification_allowlist
  };
}

function phaseForRole(role: AgentRole) {
  if (role === "core") return "planning";
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
