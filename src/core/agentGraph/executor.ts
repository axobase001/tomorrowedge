import { existsSync } from "node:fs";
import path from "node:path";
import type { AccessMode, TomorrowEdgeConfig } from "../../config/schema.js";
import type { AgentRole, AgentRunState } from "../../schemas/agentTask.js";
import { makeId } from "../../utils/ids.js";
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
import { buildAdvisoryPlans, runLiveAdvisory, runLiveAdvisoryForRoles } from "../model/modelAdvisory.js";
import { estimateCostUsd, preflightBudget, summarizeModelUsage } from "../model/costAccounting.js";
import { buildAccessPolicy, describeAccessPolicy } from "../permissions/accessPolicy.js";
import { buildLivePatchPlans, runLivePatchCandidates } from "../model/livePatchGenerator.js";
import { buildVisionCostPrompt, estimateVisionInputTokens, runLiveVisionSpec } from "../model/liveVisionSpec.js";
import { chatWithProviderFallback } from "../model/providerFallback.js";
import { buildDebateRounds, buildModelDebateRounds } from "../debate/debateEngine.js";
import { buildCapabilityRoute } from "../capabilities/capabilityStitching.js";
import { createEventLedger, type EventLedger } from "../events/eventLedger.js";
import type { ModelBudgetStatus, ModelNote, ModelUsageSummary } from "../../schemas/modelNote.js";
import type { PatchCandidate } from "../../schemas/patchCandidate.js";
import type { Plan } from "../../schemas/plan.js";
import type { FinalSummary, RunResult } from "../../schemas/evidence.js";
import type { JudgeDecision } from "../../schemas/judge.js";
import type { ReviewReport } from "../../schemas/review.js";
import { resolveConversationTarget, targetPromptPrefix } from "../conversation/conversationTargets.js";
import { externalAgentRegistryFromConfig, type ExternalAgentRegistry } from "../externalAgents/externalAgentRegistry.js";
import type { ExternalAgentProfile } from "../externalAgents/externalAgentTypes.js";
import { externalAgentIdFromProvider } from "../externalAgents/externalAgentRouter.js";
import { invokeExternalRole, releaseExternalAgentProcessPool } from "../externalAgents/externalRoleInvoker.js";
import type { ExternalRoleInvocation } from "../externalAgents/externalRoleInvoker.js";
import { buildReadOnlyTaskResult, isReadOnlyPlan } from "../goal/readOnlyTask.js";
import { createModelBackedPlan } from "../goal/modelPlanner.js";
import { classifyTaskGovernance } from "../goal/taskGovernance.js";
import { applyWorkflowIntentToPlan, classifyWorkflowIntent, type WorkflowIntentDecision } from "../goal/workflowIntent.js";
import { runtimeArtifactFromText, type RuntimeArtifactKind } from "../contextProjection/artifactView.js";
import { projectRuntimeArtifact, type ProviderView } from "../contextProjection/providerView.js";
import { buildPatchEvidence } from "../evidence/patchEvidence.js";
import { buildTestEvidence } from "../evidence/testEvidence.js";
import { buildReviewEvidence } from "../evidence/reviewEvidence.js";
import { buildJudgeEvidence } from "../evidence/judgeEvidence.js";
import type { EvidencePacket } from "../evidence/evidencePacket.js";
import { validateEvidenceDependencies, type EvidenceDependencyGap } from "../evidence/evidenceDependency.js";
import { computeTraceCompleteness } from "../diagnostics/traceCompleteness.js";
import { buildRoleRoutingDecision } from "../roleRouting/roleRoutingPolicy.js";
import { allocateStrongAgentCall } from "../budget/budgetAllocator.js";
import { canFallbackWhenBudgetBlocked, commitRoleCall, createBudgetRuntimeState, evaluateModelCallInvocation, evaluateRoleInvocation, releaseRoleCall, reserveRoleCall, type BudgetGateDecision } from "../budget/budgetGate.js";
import type { RouteAssignment } from "../routing/policies.js";
import type { EventPhase, ObservedOutcome, OutcomeMismatchType, OutcomePredictionEvent, OutcomeTarget, PredictedOutcome, ShellRunEvent, TomorrowEdgeEvent } from "../events/eventTypes.js";
import { buildRoleGraph } from "../orchestration/roleGraph.js";
import { createRoleGraphExecutionState, markRoleNodeResult, markRoleNodeRunning } from "../orchestration/roleGraphScheduler.js";
import { inferWorkflowKindFromEvents, workflowKindFromPlan } from "../orchestration/workflowKind.js";
import { getCachedContextSelection, getCachedPlan, rememberContextSelection, rememberPlan } from "../context/contextCache.js";
import {
  applyCoderConstraintsToCandidate,
  applyMemoryAssessmentsToJudge,
  applyMemoryAssessmentsToReview,
  applyPremortemToPlan,
  applyRepairMemoryContextToCandidate,
  buildCandidateMemoryAssessments,
  buildFailureMemoryPremortem,
  buildRepairMemoryContext,
  buildRepairMemoryQuery,
  coderConstraintsFromPremortem,
  emptyFailureMemoryInfluence,
  type CandidateMemoryAssessment,
  type FailureMemoryPremortem,
  type RepairMemoryContext
} from "../memory/failureMemoryInfluence.js";
import { explainFailureMemories } from "../memory/taskMemory.js";
import { decideRepairPolicy, type RepairPolicyDecision } from "../errorLoop/repairPolicy.js";
import { applyMemoryRetrievalPolicy, type MemoryRetrievalPolicyDecision } from "../memory/retrievalPolicy.js";
import { profileScenario } from "../scenarios/scenarioProfiler.js";
import { generateNativeObjectiveContract } from "../contracts/contractGenerator.js";
import { verifyAndRepairContract } from "../contracts/contractVerifier.js";
import { contractToPlan, overlayPlanWithContract } from "../contracts/contractToPlan.js";
import { renderObjectiveContractArtifact } from "../contracts/contractArtifacts.js";
import { retrieveSimilarWithDiagnostics, addTrace } from "../traces/traceStore.js";
import type { ObjectiveTraceV1 } from "../traces/objectiveTrace.js";
import { defaultOrchestrationPolicy, type OrchestrationPolicyGenome, type SelfIterationMode } from "../orchestrationPolicy/orchestrationPolicy.js";
import { loadBestPolicy, savePolicyScore } from "../orchestrationPolicy/policyStore.js";
import { evaluatePolicyFitness, policyWithFitness } from "../orchestrationPolicy/policyEvaluator.js";
import { evolvePoliciesOffline } from "../orchestrationPolicy/policyEvolution.js";
import { simulatePolicyOnTrace } from "../orchestrationPolicy/policyCounterfactual.js";
import { buildTaskGraph } from "../planning/taskGraphBuilder.js";
import { validateTaskGraph } from "../planning/taskGraphValidator.js";
import { buildDebateSession } from "../debate/debateSessionBuilder.js";
import { loadSkillRegistry } from "../skills/skillRegistry.js";
import { routeToolsAndSkills } from "../skills/toolSkillRouter.js";
import {
  applyPolicyToContract,
  contractPhaseAllowed,
  contractRoleAllowed,
  contractToolGate,
  contractVerificationBlocksExecution,
  effectiveMaxRepairRounds,
  effectiveMaxShellRuns,
  policyAllowsPartialCompletion,
  policyBudgetEstimate,
  policyEscalationSignals,
  policyRouteTag,
  policyStopMode,
  requiredEvidenceThreshold,
  shouldPolicyRequireJudge,
  shouldPolicyRequireReviewer,
  shouldRetryFailedVerification,
  shouldRetryMissingEvidence,
  shouldStopOnRecurringFailure,
  traceCompletenessThreshold
} from "../orchestrationPolicy/runtimePolicy.js";

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
  dryRun?: boolean;
  onEvent?: (event: TomorrowEdgeEvent) => void;
  sessionId?: string;
};

type OfflineGraphRuntime = {
  cwd: string;
  goal: string;
  config: TomorrowEdgeConfig;
  options: OfflineGraphOptions;
  router: ModelRouter;
  externalAgents: ExternalAgentRegistry;
  access: AgentGraphState["access"];
  ledger: EventLedger;
  startedAtMs: number;
  conversationTarget: NonNullable<AgentGraphState["conversationTarget"]>;
  imagePaths: string[];
};

export async function runOfflineGraph(cwd: string, goal: string, config: TomorrowEdgeConfig, options: OfflineGraphOptions = {}): Promise<AgentGraphState> {
  const runtime = createOfflineGraphRuntime(cwd, goal, config, options);
  const state = createInitialGraphState(runtime);

  recordStartupPhase(runtime, state);
  const workflowIntent = await runRoutingIntentPhase(runtime, state);
  await runExternalCorePhase(runtime, state);
  await runVisionPhase(runtime, state);
  await runContractPhase(runtime, state, workflowIntent);
  if (contractVerificationBlocksExecution(state.contractVerification)) {
    return finalizeBlockedByContract(runtime, state, "Objective contract verification failed; execution blocked before planning, patch, shell, or repair.");
  }
  await runPlanningPhase(runtime, state, workflowIntent);
  await runExplorationPhase(runtime, state);
  if (isReadOnlyPlan(state.plan!)) {
    await maybeRunGovernedReadOnlyAdvisory({ cwd, goal, config, router: runtime.router, ledger: runtime.ledger, state, access: runtime.access });
    return finalizeReadOnlyState(runtime, state);
  }

  await runCandidatePhase(runtime, state);
  await runReviewAndJudgePhase(runtime, state);
  if (shouldSkipPostJudgeLiveAdvisory(runtime, state)) {
    runtime.ledger.append({
      type: "evidence_update",
      phase: "judge",
      role: "judge",
      evidence: ["post-judge live advisory skipped because live patch already produced the selected approval candidate"]
    });
  } else {
    await runLiveAdvisoryPhase(runtime, state);
  }
  await runPatchApplicationPhase(runtime, state);
  await runVerificationAndRepairPhase(runtime, state);
  return finalizeState(runtime, state);
}

function createOfflineGraphRuntime(cwd: string, goal: string, config: TomorrowEdgeConfig, options: OfflineGraphOptions): OfflineGraphRuntime {
  const router = new ModelRouter(config);
  const externalAgents = externalAgentRegistryFromConfig(config);
  const access = buildAccessPolicy(config, {
    mode: options.accessMode,
    approvePatch: options.approvePatch,
    approveShell: options.approveShell,
    approveRepair: options.approveRepair
  });
  const ledger = createEventLedger(access.mode, options.sessionId, options.onEvent);
  return {
    cwd,
    goal,
    config,
    options,
    router,
    externalAgents,
    access,
    ledger,
    startedAtMs: Date.now(),
    conversationTarget: resolveConversationTarget(config, options.conversationTarget),
    imagePaths: validateImagePaths(cwd, options.imagePaths ?? [])
  };
}

function createInitialGraphState(runtime: OfflineGraphRuntime): AgentGraphState {
  const state: AgentGraphState = {
    sessionId: runtime.ledger.sessionId,
    goal: runtime.goal,
    conversationTarget: runtime.conversationTarget,
    routing: runtime.router.getPlan(),
    access: runtime.access,
    events: runtime.ledger.events,
    eventArtifacts: runtime.ledger.artifacts,
    providerViews: [],
    evidencePackets: [],
    agents: [],
    candidates: [],
    repairCandidates: [],
    debateRounds: [],
    modelNotes: [],
    usageSummary: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    failureMemory: emptyFailureMemoryInfluence(),
    budgetRuntime: createBudgetRuntimeState(),
    budgetStatuses: [],
    changedFiles: [],
    runResults: [],
    approvals: {
      patchApproved: runtime.access.patchApproved,
      shellApproved: runtime.access.shellApproved,
      repairApproved: runtime.access.repairApproved
    }
  };
  return state;
}

function recordStartupPhase(runtime: OfflineGraphRuntime, state: AgentGraphState): void {
  const { access, conversationTarget, goal, config, ledger } = runtime;
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
  for (const assignment of state.routing.assignments) {
    recordRoutingAndBudgetPreview(config, state, ledger, assignment, goal, "routing");
  }
}

async function runRoutingIntentPhase(runtime: OfflineGraphRuntime, state: AgentGraphState): Promise<WorkflowIntentDecision> {
  const { access, config, goal, ledger, options, router, imagePaths } = runtime;
  if (!imagePaths.length) {
    state.routing = {
      ...state.routing,
      assignments: state.routing.assignments.filter((assignment) => assignment.role !== "vision")
    };
  }
  state.capabilityRoute = buildCapabilityRoute({ goal, imagePaths, router });
  const workflowIntent = await classifyWorkflowIntent({ goal, config, router, ledger, fixtureMode: options.fixtureMode || options.provider === "fixture", localOnly: !access.cloudAllowed });
  state.workflowKind = workflowIntent.workflowKind;
  ledger.append({
    type: "workflow_intent",
    phase: "routing",
    role: "planner",
    provider: workflowIntent.provider,
    model: workflowIntent.model,
    intent: workflowIntent.intent,
    requiresPatchWorkflow: workflowIntent.requiresPatchWorkflow,
    workflowKind: workflowIntent.workflowKind,
    confidence: workflowIntent.confidence,
    reason: workflowIntent.reason,
    fallbackUsed: workflowIntent.fallbackUsed
  });
  return workflowIntent;
}

async function runContractPhase(runtime: OfflineGraphRuntime, state: AgentGraphState, workflowIntent: WorkflowIntentDecision): Promise<void> {
  const { access, config, cwd, goal, imagePaths, ledger, router } = runtime;
  const scenarioProfile = profileScenario({ goal, workflowIntent, accessMode: access.mode, hasImageInputs: imagePaths.length > 0 });
  state.scenarioProfile = scenarioProfile;
  ledger.append({
    type: "scenario_profile",
    phase: "planning",
    role: "planner",
    scenarioType: scenarioProfile.scenarioType,
    workflowKind: scenarioProfile.likelyWorkflowKind,
    ambiguityLevel: scenarioProfile.ambiguityLevel,
    expectedDeliverable: scenarioProfile.expectedDeliverable,
    riskSignals: scenarioProfile.riskSignals,
    profileRef: ledger.writeArtifact("scenario_profiles", JSON.stringify(scenarioProfile, null, 2), "json")
  });

  const policyMode = selfIterationMode(config);
  const policy = await selectOrchestrationPolicy(cwd, policyMode, scenarioProfile.scenarioType);
  state.orchestrationPolicy = policy;
  ledger.append({
    type: "orchestration_policy_selected",
    phase: "planning",
    role: "planner",
    policyId: policy.policyId,
    policyMode,
    contractDepth: policy.contractPolicy.contractDepth,
    traceTopK: policy.tracePolicy.traceTopK,
    verificationStrictness: policy.verificationPolicy.verificationStrictness,
    repairRounds: policy.repairPolicy.maxRepairRounds,
    stopMode: policy.stopPolicy.stopMode,
    policyRef: ledger.writeArtifact("policies", JSON.stringify(policy, null, 2), "json")
  });
  const policyRouteChanges = router.applyPolicyRoutingPreference(policy);
  if (policyRouteChanges.length) {
    state.routing = routingForState(router, imagePaths.length > 0);
    for (const change of policyRouteChanges) {
      recordRoutingAndBudgetPreview(config, state, ledger, {
        ...change.to,
        reason: `${change.reason}; previous route was ${change.from.provider}/${change.from.model}`
      }, goal, "planning");
    }
  }

  const retrieval = policyMode === "off"
    ? { selected: [], rejected: [], consideredCount: 0 }
    : await retrieveSimilarWithDiagnostics(cwd, goal, scenarioProfile, policy.tracePolicy.traceTopK, policy.tracePolicy);
  const retrievedTraces = retrieval.selected;
  state.retrievedObjectiveTraces = retrievedTraces;
  ledger.append({
    type: "trace_retrieval",
    phase: "memory",
    role: "planner",
    selectedTraceIds: retrievedTraces.map((trace) => trace.traceId),
    rejectedCount: retrieval.rejected.length,
    policyMode,
    summary: retrievedTraces.length ? `Retrieved ${retrievedTraces.length} objective-action-feedback trace(s).` : "No similar objective trace found.",
    artifactRef: ledger.writeArtifact("objective_trace_retrieval", JSON.stringify({
      consideredCount: retrieval.consideredCount,
      selected: retrievedTraces.map((trace) => ({
        traceId: trace.traceId,
        scenarioType: trace.scenarioProfile.scenarioType,
        workflowKind: trace.planSummary.workflowKind,
        finalStatus: trace.outcome.finalStatus,
        lessons: trace.outcome.lessons
      })),
      rejected: retrieval.rejected
    }, null, 2), "json")
  });

  const generatedBaseline = generateNativeObjectiveContract({
    goal,
    workflowIntent,
    scenarioProfile,
    retrievedTraces,
    config,
    accessMode: access.mode
  });
  const generated = applyPolicyToContract(generatedBaseline, policy);
  const { contract, verification } = verifyAndRepairContract(generated, {
    accessMode: access.mode,
    workflowIntent,
    scenarioProfile,
    config,
    baseline: generatedBaseline
  });
  state.objectiveContract = contract;
  state.contractVerification = verification;
  state.workflowKind = contract.workflowKind;
  ledger.append({
    type: "objective_contract",
    phase: "planning",
    role: "planner",
    contractId: contract.contractId,
    contractRef: ledger.writeArtifact("objective_contracts", renderObjectiveContractArtifact(contract), "json"),
    localObjective: contract.localObjective,
    scenarioType: contract.scenarioType,
    workflowKind: contract.workflowKind,
    riskLevel: contract.riskLevel,
    source: contract.source
  });
  ledger.append({
    type: "contract_verification",
    phase: "planning",
    role: "planner",
    contractId: contract.contractId,
    status: verification.status,
    score: verification.score,
    missing: verification.missing,
    violations: verification.violations,
    repairs: verification.repairs,
    verificationRef: ledger.writeArtifact("contract_verifications", JSON.stringify(verification, null, 2), "json")
  });

  const skillRegistry = await loadSkillRegistry(cwd);
  const toolSkillRoutes = routeToolsAndSkills({
    registry: skillRegistry.registry,
    contract,
    scenarioProfile,
    accessMode: access.mode,
    policy
  });
  state.toolSkillRoutes = toolSkillRoutes;
  const selectedSkillIds = toolSkillRoutes.filter((route) => route.selected).map((route) => route.skillId);
  ledger.append({
    type: "tool_skill_routing",
    phase: "routing",
    role: "planner",
    selectedSkillIds,
    skippedCount: toolSkillRoutes.filter((route) => route.status === "skipped").length,
    blockedCount: toolSkillRoutes.filter((route) => route.status === "blocked").length,
    preference: policy.toolRoutingPolicy.preference,
    summary: selectedSkillIds.length ? `Selected ${selectedSkillIds.length} governed tool/skill route(s).` : "No governed tool/skill route selected.",
    artifactRef: ledger.writeArtifact("tool_skill_routing", JSON.stringify({
      registryErrors: skillRegistry.errors,
      routes: toolSkillRoutes
    }, null, 2), "json")
  });
}

async function selectOrchestrationPolicy(cwd: string, mode: SelfIterationMode, scenarioType: NonNullable<AgentGraphState["scenarioProfile"]>["scenarioType"]): Promise<OrchestrationPolicyGenome> {
  if (mode === "off") return defaultOrchestrationPolicy();
  const policy = await loadBestPolicy(cwd, scenarioType);
  return {
    ...policy,
    metadata: {
      ...policy.metadata,
      source: policy.metadata.source === "default" ? "default" : "selected",
      scenarioType
    }
  };
}

function selfIterationMode(config: TomorrowEdgeConfig): SelfIterationMode {
  if (!config.self_iterating_orchestration.enabled) return "off";
  return config.self_iterating_orchestration.mode;
}

async function runExternalCorePhase(runtime: OfflineGraphRuntime, state: AgentGraphState): Promise<void> {
  const { access, config, conversationTarget, cwd, externalAgents, goal, ledger, router } = runtime;
  const externalCore = externalProfileForRole(router, externalAgents, "core");
  if (externalCore) {
    const assignment = router.assignmentFor("core");
    if (!access.cloudAllowed) {
      recordAccessBlockedExternalAgent(state, ledger, "core", assignment, `External core blocked by access mode: ${access.mode}.`);
      return;
    }
    const coreResult = await runAgentState(state, ledger, router, "core", () =>
      invokeExternalRole({
        cwd,
        profile: externalCore,
        role: "core",
        prompt: `Act as TomorrowEdge Core. Plan and supervise this workflow: ${goal}`,
        context: { goal, routing: state.routing, access: state.access, conversationTarget },
        ledger
      }),
      {
        agentKind: "external",
        config,
        budgetFallback: async (): Promise<ExternalRoleInvocation> => ({
          externalAgentId: externalCore.id,
          role: "core",
          attempts: 0,
          summary: "Native planner used because external core was budget-blocked.",
          payload: await new PlannerAgent().run({ goal: [targetPromptPrefix(conversationTarget), goal].filter(Boolean).join("\n\n") })
        }),
        budgetFallbackLabel: "native planner"
      }
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
}

async function runVisionPhase(runtime: OfflineGraphRuntime, state: AgentGraphState): Promise<void> {
  const { access, config, goal, imagePaths, ledger, options, router } = runtime;
  if (imagePaths.length) {
    const vision = new VisionAgent();
    if (options.liveVision && access.cloudAllowed) {
      const assignment = router.assignmentFor("vision");
      const budgetStatus = setBudgetStatus(state, preflightBudget(
        [{ provider: assignment.provider, prompt: buildVisionCostPrompt(goal, imagePaths), estimatedInputTokens: estimateVisionInputTokens(goal, imagePaths), maxOutputTokens: 1200 }],
        config.routing.max_cost_usd
      ));
      if (budgetStatus.status !== "blocked") {
        const liveVision = await runAgentState(state, ledger, router, "vision", () => runLiveVisionSpec({ goal, imagePaths, config, router, ledger }), {
          agentKind: "live",
          config,
          budgetFallback: async () => {
            const spec = await vision.run({ goal, imagePaths });
            return {
              spec,
              note: {
                id: "native_vision_budget_fallback",
                role: "vision" as const,
                provider: "local_tool",
                model: "native_vision",
                kind: "vision_spec" as const,
                content: spec.handoffPrompt,
                fallbackUsed: true,
                fallbackReason: "budget gate fallback"
              }
            };
          },
          budgetFallbackLabel: "native vision"
        });
        state.modelNotes.push(liveVision.note);
        refreshUsageSummary(state);
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
      state.visualSpec = await runAgentState(state, ledger, router, "vision", () => vision.run({ goal, imagePaths }), "offline");
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
}

async function runPlanningPhase(runtime: OfflineGraphRuntime, state: AgentGraphState, workflowIntent: WorkflowIntentDecision): Promise<void> {
  const { access, config, cwd, externalAgents, goal, imagePaths, ledger, options, router, conversationTarget } = runtime;
  const planner = new PlannerAgent();
  const policy = state.orchestrationPolicy;
  const contractPlan = state.objectiveContract ? contractToPlan(state.objectiveContract, policy) : undefined;
  const contractPrompt = state.objectiveContract
    ? [
        "Objective Contract:",
        `localObjective=${state.objectiveContract.localObjective}`,
        `successCriteria=${state.objectiveContract.successCriteria.join(" | ")}`,
        `requiredEvidence=${state.objectiveContract.requiredEvidence.join(" | ")}`,
        `allowedTools=${state.objectiveContract.allowedTools.join(", ")}`,
        `forbiddenActions=${state.objectiveContract.forbiddenActions.join(", ")}`,
        `stopCondition.success=${state.objectiveContract.stopCondition.success.join(" | ")}`
      ].join("\n")
    : undefined;
  const plannerGoal = [targetPromptPrefix(conversationTarget), contractPrompt, goal, state.visualSpec?.handoffPrompt].filter(Boolean).join("\n\n");
  const externalPlanner = externalProfileForRole(router, externalAgents, "planner");
  const planFromExternalCore = Boolean(state.plan);
  const cachedPlan = !state.plan && !externalPlanner ? getCachedPlan(cwd, plannerGoal) : undefined;
  if (!state.plan && !externalPlanner) {
    ledger.append({ type: "agent_cache", phase: "planning", role: "planner", cache: "planner", status: cachedPlan ? "hit" : "miss", keyHint: plannerGoal.slice(0, 80) });
  }
  state.plan = state.plan ?? cachedPlan ?? await runAgentState(state, ledger, router, "planner", async () => {
    if (!externalPlanner) return planner.run({ goal: plannerGoal });
    const result = await invokeExternalRole({
      cwd,
      profile: externalPlanner,
      role: "planner",
      prompt: `Create a TomorrowEdge plan from this Objective Contract and goal: ${plannerGoal}`,
      context: { goal: plannerGoal, objectiveContract: state.objectiveContract, visualSpec: state.visualSpec, routing: state.routing },
      ledger
    });
    const plan = normalizeExternalPlan(result.payload, goal);
    if (!plan) recordExternalNormalizeFallback(ledger, "planner", externalPlanner, "plan", "native planner");
    return plan ?? planner.run({ goal: plannerGoal });
  }, externalPlanner ? {
    agentKind: "external",
    config,
    budgetFallback: () => planner.run({ goal: plannerGoal }),
    budgetFallbackLabel: "native planner"
  } : "offline");
  state.plan = state.objectiveContract && state.plan ? overlayPlanWithContract(state.plan, state.objectiveContract, policy) : state.plan ?? contractPlan;
  if (!externalPlanner && !planFromExternalCore && !cachedPlan && state.plan && workflowIntent.requiresPatchWorkflow) {
    const plannerModelAllowed = canUseGovernanceModel(runtime, state, "planner", plannerGoal, 900, "model-backed planner");
    const modelPlan = plannerModelAllowed
      ? await createModelBackedPlan({ goal, config, router, ledger, localOnly: options.fixtureMode || !access.cloudAllowed })
      : { provider: "local_planner_fallback", model: "native", fallbackUsed: true, error: "Model-backed planner blocked before invocation by budget or access policy." };
    if (modelPlan.plan) {
      state.plan = state.objectiveContract
        ? overlayPlanWithContract({ ...modelPlan.plan, constraints: uniqueStrings([...(state.plan.constraints ?? []), ...modelPlan.plan.constraints]) }, state.objectiveContract, policy)
        : {
            ...modelPlan.plan,
            constraints: uniqueStrings([...(state.plan.constraints ?? []), ...modelPlan.plan.constraints])
          };
      updateCapabilityStep(state, "planner", "success", "planner completed");
      ledger.append({
        type: "evidence_update",
        phase: "planning",
        role: "planner",
        provider: modelPlan.provider,
        model: modelPlan.model,
        evidence: [`model-backed planner produced ${state.plan.steps.length} step(s)`, `risk=${state.plan.riskLevel}`, `taskType=${state.plan.taskType}`],
        evidenceRef: ledger.writeArtifact("summaries", JSON.stringify(state.plan, null, 2), "json")
      });
    } else {
      ledger.append({
        type: "fallback_to_native",
        phase: "planning",
        fallbackRole: "planner",
        reason: `Model-backed planner unavailable; using native adaptive planner. ${modelPlan.error ?? ""}`.trim()
      });
    }
  }
  state.plan = { ...(state.plan ?? { steps: [], constraints: [], riskLevel: "low" as const, taskType: "test" as const, verificationCommands: [], debateRecommended: false }), goal };
  state.plan = applyWorkflowIntentToPlan(state.plan, workflowIntent);
  if (state.objectiveContract) state.plan = overlayPlanWithContract(state.plan, state.objectiveContract, policy);
  const governanceModelAllowed = canUseGovernanceModel(runtime, state, "planner", goal, 360, "task governance");
  state.taskGovernance = await classifyTaskGovernance({
    goal,
    plan: state.plan,
    workflowIntent,
    config,
    router,
    ledger,
    localOnly: options.fixtureMode || options.provider === "fixture" || !access.cloudAllowed,
    modelDisabled: !governanceModelAllowed
  });
  ledger.append({
    type: "task_governance",
    phase: "planning",
    role: "planner",
    provider: state.taskGovernance.provider,
    model: state.taskGovernance.model,
    reasoningSensitivity: state.taskGovernance.reasoningSensitivity,
    requiresReviewer: state.taskGovernance.requiresReviewer,
    requiresJudge: state.taskGovernance.requiresJudge,
    confidence: state.taskGovernance.confidence,
    reason: state.taskGovernance.reason,
    fallbackUsed: state.taskGovernance.fallbackUsed
  });
  state.plan = applyTaskGovernanceToPlan(state.plan, state.taskGovernance);
  state.plan = applyPolicyGovernanceToPlan(state.plan, policy);
  if (state.objectiveContract) state.plan = overlayPlanWithContract(state.plan, state.objectiveContract, policy);
  state.plan = enforceParallelRolePolicy(state.plan, policy);
  if (!externalPlanner) {
    rememberPlan(cwd, plannerGoal, state.plan);
    ledger.append({ type: "agent_cache", phase: "planning", role: "planner", cache: "planner", status: "write", keyHint: plannerGoal.slice(0, 80) });
  }
  await runFailureMemoryPremortem(runtime, state);
  const plan = state.plan;
  if (!plan) throw new Error("Planning phase completed without a plan.");
  state.workflowKind = workflowKindFromPlan(plan);
  state.roleGraph = buildRoleGraph({
    workflowKind: state.workflowKind,
    riskLevel: plan.riskLevel,
    highRisk: plan.riskLevel === "high",
    debate: parallelRolesAllowed(state) && Boolean(plan.debateRecommended || config.debate.enabled),
    allowParallelRoles: parallelRolesAllowed(state),
    allowedRoles: state.objectiveContract?.allowedRoles,
    allowedPhases: state.objectiveContract?.allowedPhases
  });
  state.roleGraphExecution = createRoleGraphExecutionState(state.roleGraph);
  state.plan.taskGraph = state.plan.taskGraph ?? buildTaskGraph({
    plan: state.plan,
    contract: state.objectiveContract,
    roleGraph: state.roleGraph,
    policy
  });
  const taskGraphValidation = validateTaskGraph(state.plan.taskGraph);
  if (!taskGraphValidation.ok) {
    const repairedTaskGraph = buildTaskGraph({ plan: state.plan, contract: state.objectiveContract, roleGraph: state.roleGraph, policy });
    const repairedValidation = validateTaskGraph(repairedTaskGraph);
    state.plan.taskGraph = repairedTaskGraph;
    ledger.append({
      type: "evidence_gap",
      phase: "planning",
      role: "planner",
      missing: taskGraphValidation.errors,
      blocking: Boolean(policy?.taskGraphPolicy?.stopOnInvalidGraph && !repairedValidation.ok),
      reason: repairedValidation.ok ? "Invalid planner taskGraph was repaired by native builder." : "TaskGraph validation failed after repair."
    });
  }
  recordTaskGraphEvent(state, ledger);
  const rerouteChanges = router.rerouteAfterPlan(plan, { hasImageInputs: imagePaths.length > 0 });
  if (rerouteChanges.length) {
    state.routing = routingForState(router, imagePaths.length > 0);
    for (const change of rerouteChanges) {
      recordRoutingAndBudgetPreview(config, state, ledger, {
        ...change.to,
        reason: `${change.reason}; previous route was ${change.from.provider}/${change.from.model}`
      }, goal, "planning");
    }
  }
  ledger.append({ type: "evidence_update", phase: "planning", role: "planner", evidence: plan.steps.map((step) => step.title), evidenceRef: ledger.writeArtifact("summaries", JSON.stringify(plan, null, 2), "json") });
}

async function runFailureMemoryPremortem(runtime: OfflineGraphRuntime, state: AgentGraphState): Promise<void> {
  const { config, cwd, goal, ledger } = runtime;
  if (!state.plan || !failureMemoryEnabled(config, "failure_premortem")) return;
  const policyResult = applyMemoryRetrievalPolicy(
    await explainFailureMemories(cwd, goal, { limit: config.strategy_memory.max_records }),
    config.strategy_memory.policy,
    runtime.ledger.sessionId
  );
  recordMemoryPolicyDecision(ledger, "premortem", "planner", policyResult.decision);
  const explanation = policyResult.explanation;
  const premortem = buildFailureMemoryPremortem(goal, explanation);
  state.failureMemory = state.failureMemory ?? emptyFailureMemoryInfluence();
  state.failureMemory.premortem = premortem;
  if (premortem.constraints.length) {
    state.plan = applyPremortemToPlan(state.plan, premortem);
  }
  if (failureMemoryEnabled(config, "coder_constraints")) {
    state.failureMemory.coderConstraints = coderConstraintsFromPremortem(premortem);
  }
  recordMemoryRetrieval(state, ledger, "premortem", "planner", premortem, `pre-mortem selected ${premortem.selectedMemoryIds.length} memories`);
}

async function runExplorationPhase(runtime: OfflineGraphRuntime, state: AgentGraphState): Promise<void> {
  const { cwd, ledger, router } = runtime;
  const plan = state.plan;
  if (!plan) throw new Error("Exploration phase requires a plan.");
  const explorer = new ExplorerAgent();
  const cachedContextSelection = await getCachedContextSelection(cwd, plan);
  ledger.append({ type: "agent_cache", phase: "exploration", role: "explorer", cache: "explorer", status: cachedContextSelection ? "hit" : "miss", keyHint: `${plan.taskType}:${plan.expectedFiles?.join(",") ?? ""}`.slice(0, 80) });
  state.contextSelection = cachedContextSelection ?? await runAgentState(state, ledger, router, "explorer", () => explorer.run({ plan }, { cwd, router }), "offline");
  if (!cachedContextSelection) {
    await rememberContextSelection(cwd, plan, state.contextSelection);
    ledger.append({ type: "agent_cache", phase: "exploration", role: "explorer", cache: "explorer", status: "write", keyHint: `${plan.taskType}:${plan.expectedFiles?.join(",") ?? ""}`.slice(0, 80) });
  }
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
}

async function runCandidatePhase(runtime: OfflineGraphRuntime, state: AgentGraphState): Promise<void> {
  const { access, config, cwd, externalAgents, goal, ledger, options, router } = runtime;
  const coder = new CoderAgent();
  if (state.failureMemory?.coderConstraints.length) {
    recordMemoryRetrieval(state, ledger, "coder_constraints", "coder_a", {
      selectedMemoryIds: uniqueStrings(state.failureMemory.coderConstraints.map((constraint) => constraint.memoryId)),
      rejected: [],
      constraints: state.failureMemory.coderConstraints
    }, `coder-visible memory constraints=${state.failureMemory.coderConstraints.length}`);
  }
  const livePatchPrimary = Boolean(options.livePatch && access.cloudAllowed);
  const candidateJobs: Array<{ label: string; run: () => Promise<{ candidates: PatchCandidate[]; notes: ModelNote[] }> }> = livePatchPrimary ? [] : [
    {
      label: "coder_a",
      run: async () => ({
        candidates: [await runCoderCandidate({ cwd, state, ledger, router, externalAgents, coder, role: "coder_a", variant: "a", options, config })],
        notes: []
      })
    }
  ];
  const allowParallelRoles = parallelRolesAllowed(state);
  if (!livePatchPrimary && allowParallelRoles && config.debate.enabled && config.debate.max_candidates > 1) {
    candidateJobs.push({
      label: "coder_b",
      run: async () => ({
        candidates: [await runCoderCandidate({ cwd, state, ledger, router, externalAgents, coder, role: "coder_b", variant: "b", options, config })],
        notes: []
      })
    });
  }
  if (options.livePatch && !allowParallelRoles) {
    ledger.append({
      type: "evidence_update",
      phase: "coding",
      role: "coder_a",
      evidence: ["live patch optional branch disabled by planningPolicy.allowParallelRoles=false"]
    });
  } else if (options.livePatch && access.cloudAllowed) {
    candidateJobs.push({
      label: "livePatch",
      run: async () => {
        const livePatchInput = {
          cwd,
          goal,
          config,
          router,
          plan: state.plan!,
          contextSelection: state.contextSelection!,
          visualSpec: state.visualSpec,
          ledger,
          allowParallelRoles
        };
        const patchPlans = await buildLivePatchPlans(livePatchInput);
        const budgetStatus = setBudgetStatus(state, preflightBudget(
          patchPlans.map((plan) => ({ provider: plan.provider, prompt: plan.prompt, maxOutputTokens: plan.maxOutputTokens })),
          config.routing.max_cost_usd
        ));
        recordLiveBudgetDecisions(ledger, "coding", patchPlans, budgetStatus);
        if (budgetStatus.status === "blocked") return { candidates: [], notes: [] };
        const livePatchResult = await runLivePatchCandidates(livePatchInput);
        return { candidates: livePatchResult.candidates, notes: livePatchResult.notes };
      }
    });
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
  const candidateAgentStartIndex = state.agents.length;
  const candidateResults = await Promise.allSettled(candidateJobs.map((job) => job.run()));
  normalizeCandidateAgentOrder(state, candidateAgentStartIndex, candidateJobs.map((job) => job.label));
  for (const [index, result] of candidateResults.entries()) {
    const label = candidateJobs[index]?.label ?? "candidate";
    if (result.status === "rejected") {
      ledger.append({
        type: "agent_run",
        phase: "coding",
        role: label === "livePatch" ? "coder_a" : label as AgentRole,
        provider: label === "livePatch" ? "live_patch" : router.assignmentFor(label as AgentRole).provider,
        model: label === "livePatch" ? "candidate_generator" : router.assignmentFor(label as AgentRole).model,
        agentKind: label === "livePatch" ? "live" : "offline",
        status: "failure",
        runId: `${label}_candidate_job`,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason)
      });
      continue;
    }
    state.candidates.push(...result.value.candidates);
    for (const candidate of result.value.candidates) recordPatchCandidateEvent(state, ledger, candidate.agentId as AgentRole, candidate);
    if (result.value.notes.length) {
      state.modelNotes.push(...result.value.notes);
      refreshUsageSummary(state);
      recordModelNoteEvents(ledger, result.value.notes, state.usageSummary);
    }
  }
  if (livePatchPrimary && state.candidates.length === 0) {
    ledger.append({
      type: "fallback_to_native",
      phase: "coding",
      fallbackRole: "coder_a",
      reason: "Live patch produced no candidate; falling back to native coder_a without mixing candidate sets."
    });
    const fallback = await runCoderCandidate({ cwd, state, ledger, router, externalAgents, coder, role: "coder_a", variant: "a", options, config });
    state.candidates.push(fallback);
    recordPatchCandidateEvent(state, ledger, "coder_a", fallback);
  }
}

function shouldSkipPostJudgeLiveAdvisory(runtime: OfflineGraphRuntime, state: AgentGraphState): boolean {
  if (!runtime.options.liveAdvisory || !runtime.options.livePatch) return false;
  const selectedId = state.judge?.selectedCandidateId;
  if (!selectedId || state.judge?.decision !== "select") return false;
  const selected = state.candidates.find((candidate) => candidate.candidateId === selectedId);
  return Boolean(selected?.candidateId.startsWith("live_") || selected?.agentId === "coder_a" && selected.summary.toLowerCase().includes("live"));
}

async function runReviewAndJudgePhase(runtime: OfflineGraphRuntime, state: AgentGraphState): Promise<void> {
  const { access, config, cwd, externalAgents, goal, ledger, options, router } = runtime;
  const reviewer = new ReviewerAgent();
  const externalReviewer = externalProfileForRole(router, externalAgents, "reviewer");
  const memoryAssessments = failureMemoryEnabled(config, "review_guard")
    ? buildCandidateMemoryAssessments(state.candidates, state.failureMemory?.coderConstraints ?? [])
    : [];
  if (memoryAssessments.length) {
    state.failureMemory = state.failureMemory ?? emptyFailureMemoryInfluence();
    state.failureMemory.reviewAssessments = memoryAssessments;
    recordMemoryRetrieval(state, ledger, "review_guard", "reviewer", {
      selectedMemoryIds: uniqueStrings(memoryAssessments.flatMap((assessment) => assessment.memoryIds)),
      rejected: [],
      constraints: memoryAssessments
    }, `review memory assessments=${memoryAssessments.length}`);
  }
  recordEvidenceGaps(ledger, validateEvidenceDependencies({
    role: "reviewer",
    candidates: state.candidates,
    evidencePackets: state.evidencePackets
  }));
  state.review = await runAgentState(state, ledger, router, "reviewer", async () => {
    if (!externalReviewer) return reviewer.run({ candidates: state.candidates, evidencePackets: state.evidencePackets, redTeam: options.redTeamReview });
    const result = await invokeExternalRole({
      cwd,
      profile: externalReviewer,
      role: "reviewer",
      prompt: "Review the current patch candidates and return a TomorrowEdge review report.",
      context: { candidates: state.candidates, evidencePackets: state.evidencePackets, redTeam: options.redTeamReview, memoryAssessments },
      ledger
    });
    const review = normalizeExternalReview(result.payload);
    if (!review) recordExternalNormalizeFallback(ledger, "reviewer", externalReviewer, "review", "native reviewer");
    return review ?? reviewer.run({ candidates: state.candidates, evidencePackets: state.evidencePackets, redTeam: options.redTeamReview });
  }, externalReviewer ? {
    agentKind: "external",
    config,
    budgetFallback: () => reviewer.run({ candidates: state.candidates, evidencePackets: state.evidencePackets, redTeam: options.redTeamReview }),
    budgetFallbackLabel: "native reviewer"
  } : "offline");
  state.review = applyMemoryAssessmentsToReview(state.review, memoryAssessments);
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
  if (parallelRolesAllowed(state)) {
    state.debateRounds = buildDebateRounds(state.candidates, state.review, config.debate.max_rounds);
    await maybeRunPreJudgeModelDebate({ cwd, goal, config, router, ledger, state, access, options });
  } else {
    state.debateRounds = [];
  }
  state.debateSession = buildDebateSession({
    sessionId: `${state.sessionId}_debate`,
    candidates: state.candidates,
    review: state.review,
    debateRounds: state.debateRounds,
    evidencePackets: state.evidencePackets,
    maxRounds: state.orchestrationPolicy?.debatePolicy?.maxStructuredRounds ?? config.debate.max_rounds
  });
  recordDebateSessionEvents(state, ledger);
  ledger.append({ type: "evidence_update", phase: "review", role: "reviewer", evidence: [`debate rounds=${state.debateRounds.length}`] });
  recordEvidenceGaps(ledger, validateEvidenceDependencies({
    role: "judge",
    candidates: state.candidates,
    review: state.review,
    evidencePackets: state.evidencePackets
  }));

  const judge = new JudgeAgent();
  const externalJudge = externalProfileForRole(router, externalAgents, "judge");
  state.judge = await runAgentState(state, ledger, router, "judge", async () => {
    const nativeJudgeInput = {
      candidates: state.candidates,
      review: state.review!,
      evidencePackets: state.evidencePackets,
      debateRounds: state.debateRounds,
      debateSession: state.debateSession,
      allowPartialCompletion: policyAllowsPartialCompletion(state.orchestrationPolicy),
      riskLevel: state.plan?.riskLevel
    };
    if (!externalJudge) return judge.run(nativeJudgeInput);
    const result = await invokeExternalRole({
      cwd,
      profile: externalJudge,
      role: "judge",
      prompt: "Judge the reviewed candidates and return a TomorrowEdge judge decision.",
      context: { candidates: state.candidates, review: state.review, evidencePackets: state.evidencePackets, debateRounds: state.debateRounds, debateSession: state.debateSession, memoryAssessments },
      ledger
    });
    const judgment = normalizeExternalJudgment(result.payload);
    if (!judgment) recordExternalNormalizeFallback(ledger, "judge", externalJudge, "judgment", "native judge");
    return judgment ?? judge.run(nativeJudgeInput);
  }, externalJudge ? {
    agentKind: "external",
    config,
    budgetFallback: () => judge.run({
      candidates: state.candidates,
      review: state.review!,
      evidencePackets: state.evidencePackets,
      debateRounds: state.debateRounds,
      debateSession: state.debateSession,
      allowPartialCompletion: policyAllowsPartialCompletion(state.orchestrationPolicy),
      riskLevel: state.plan?.riskLevel
    }),
    budgetFallbackLabel: "native judge"
  } : "offline");
  state.judge = applyMemoryAssessmentsToJudge(state.judge, memoryAssessments);
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
    acceptedClaims: state.judge.acceptedClaims,
    rejectedClaims: state.judge.rejectedClaims,
    unresolvedBlockingIssues: state.judge.unresolvedBlockingIssues,
    evidenceCoverageScore: state.judge.evidenceCoverageScore,
    decisionRef
  });
}

async function runLiveAdvisoryPhase(runtime: OfflineGraphRuntime, state: AgentGraphState): Promise<void> {
  const { access, config, cwd, goal, ledger, options, router } = runtime;
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
      ledger,
      governance: state.taskGovernance
    };
    const advisoryPlans = buildAdvisoryPlans(advisoryInput);
    const budgetStatus = setBudgetStatus(state, preflightBudget(
      advisoryPlans.map((plan) => ({ provider: plan.provider, prompt: plan.prompt, maxOutputTokens: plan.maxOutputTokens })),
      config.routing.max_cost_usd
    ));
    recordLiveBudgetDecisions(ledger, "planning", advisoryPlans, budgetStatus);
    if (budgetStatus.status !== "blocked") {
      const advisoryNotes = await runLiveAdvisory(advisoryInput);
      state.modelNotes.push(...advisoryNotes);
      refreshUsageSummary(state);
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
}

async function runPatchApplicationPhase(runtime: OfflineGraphRuntime, state: AgentGraphState): Promise<void> {
  const { access, cwd, ledger, options, router } = runtime;
  recordEvidenceGaps(ledger, validateEvidenceDependencies({
    role: "runner",
    candidates: state.candidates,
    judge: state.judge,
    evidencePackets: state.evidencePackets
  }));
  if (state.judge?.decision === "select" && state.judge.selectedCandidateId && !contractAllowsPatchMutation(state, ledger, "patch")) return;
  if (options.dryRun && state.judge?.decision === "select" && state.judge.selectedCandidateId) {
    const selected = state.candidates.find((candidate) => candidate.candidateId === state.judge!.selectedCandidateId);
    const diffRef = selected?.unifiedDiff ? ledger.writeArtifact("diffs", selected.unifiedDiff) : undefined;
    const prediction = selected
      ? recordPatchApplicationPrediction(ledger, selected, "patch", false, "dryRun=true records the selected patch without mutating files.")
      : undefined;
    ledger.append({
      type: "patch_apply",
      phase: "patch",
      role: "runner",
      provider: "local_tool",
      model: "patch",
      candidateId: state.judge.selectedCandidateId,
      filesChanged: selected?.filesChanged ?? [],
      diffRef,
      undoSnapshotIds: [],
      applied: false,
      error: "dryRun=true; selected patch was recorded but not applied."
    });
    if (prediction) recordOutcomeObservation(ledger, prediction, "blocked", "dryRun=true; selected patch was recorded but not applied.");
  } else if (state.judge?.decision === "select" && state.judge.selectedCandidateId) {
    const selected = state.candidates.find((candidate) => candidate.candidateId === state.judge!.selectedCandidateId);
    if (selected?.unifiedDiff) {
      const diffRef = ledger.writeArtifact("diffs", selected.unifiedDiff);
      const prediction = recordPatchApplicationPrediction(ledger, selected, "patch", access.patchAllowed && access.patchApproved);
      try {
        const applyResult = await runAgentState(state, ledger, router, "runner", () => applyUnifiedDiffWithResult(cwd, selected.unifiedDiff, access.patchAllowed && access.patchApproved), "offline");
        state.changedFiles = applyResult.changedFiles;
        ledger.append({ type: "patch_apply", phase: "patch", role: "runner", provider: "local_tool", model: "patch", candidateId: selected.candidateId, filesChanged: applyResult.changedFiles, diffRef, undoSnapshotIds: applyResult.undoSnapshotIds, applied: true });
        recordOutcomeObservation(ledger, prediction, "applied", `${applyResult.changedFiles.length} file(s) changed.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ledger.append({ type: "patch_apply", phase: "patch", role: "runner", provider: "local_tool", model: "patch", candidateId: selected.candidateId, filesChanged: selected.filesChanged, diffRef, undoSnapshotIds: [], applied: false, error: message });
        recordOutcomeObservation(ledger, prediction, "blocked", message);
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
      const prediction = selected
        ? recordPatchApplicationPrediction(ledger, selected, "patch", false, "Selected candidate has no unified diff to apply.")
        : undefined;
      ledger.append({ type: "patch_apply", phase: "patch", role: "runner", provider: "local_tool", model: "patch", candidateId: state.judge.selectedCandidateId, filesChanged: [], diffRef: undefined, undoSnapshotIds: [], applied: false, error: reason });
      if (prediction) recordOutcomeObservation(ledger, prediction, "blocked", reason);
    }
  }
}

async function runVerificationAndRepairPhase(runtime: OfflineGraphRuntime, state: AgentGraphState): Promise<void> {
  const { access, config, cwd, externalAgents, ledger, options, router, startedAtMs } = runtime;
  const plan = state.plan;
  if (!plan) throw new Error("Verification phase requires a plan.");
  const testCommands = options.testCommand ? [options.testCommand] : plan.verificationCommands ?? [];
  const defaultVerification = !options.testCommand;
  let shellRuns = 0;
  let repairAttempts = 0;
  const failureOccurrences = new Map<string, number>();
  if (state.changedFiles.length && testCommands.length) {
    try {
      for (const testCommand of testCommands) {
        if (!canContinueAutonomy(config, state, ledger, startedAtMs, "shell")) return;
        if (!contractAllowsShell(state, ledger)) return;
        if (!canRunShell(config, state, shellRuns, ledger)) return;
        shellRuns += 1;
        const shellPrediction = recordShellPrediction(ledger, testCommand, state.repairCandidates.length ? "Validate the repaired patch." : "Validate the selected patch.");
        const rawResult = await runAgentState(state, ledger, router, "runner", () => runTestCommand(cwd, testCommand, shellExecutionOptions(config, access)), "offline");
        const result = normalizeVerificationResult(rawResult, { defaultVerification });
        state.runResults.push(result);
        recordShellRunEvent(state, ledger, cwd, result);
        recordOutcomeObservation(ledger, shellPrediction, observedShellOutcome(result), evidenceFromRun(result), result);
        if (result.success) continue;
        const repairPolicy = recordRepairPolicyDecision(state, ledger, result, failureOccurrences);
        if (!options.repairOnFail) break;
        if (!shouldRetryFailedVerification(state.orchestrationPolicy)) {
          ledger.append({ type: "autonomy_limit_reached", phase: "repair", status: "blocked_by_iteration_limit", reason: "Orchestration policy disables retryOnFailedVerification." });
          break;
        }
        if (!shouldRetryMissingEvidence(state.orchestrationPolicy) && state.evidencePackets.length === 0) {
          ledger.append({ type: "autonomy_limit_reached", phase: "repair", status: "blocked_by_iteration_limit", reason: "Orchestration policy disables retryOnMissingEvidence and no evidence packet is available." });
          break;
        }
        if (!allowsPatchRepair(repairPolicy)) break;
        if (!canContinueAutonomy(config, state, ledger, startedAtMs, "repair")) return;
        if (!canAttemptRepair(config, state, repairAttempts, ledger)) return;
        recordEvidenceGaps(ledger, validateEvidenceDependencies({
          role: "repairer",
          runResults: state.runResults,
          changedFiles: state.changedFiles,
          evidencePackets: state.evidencePackets
        }));
        repairAttempts += 1;
        const repairer = new RepairerAgent();
        const externalRepairer = externalProfileForRole(router, externalAgents, "repairer");
        const repairMemoryContext = await maybeBuildRepairMemoryContext(runtime, state, result);
        const repairCandidate = await runAgentState(state, ledger, router, "repairer", async () => {
          if (!externalRepairer) return repairer.run({ plan, failedRun: result, appliedFiles: state.changedFiles, fixtureMode: (options.provider === "fixture" || options.fixtureMode), memoryContext: repairMemoryContext });
          const externalResult = await invokeExternalRole({
            cwd,
            profile: externalRepairer,
            role: "repairer",
            prompt: "Repair the failed test run and return a TomorrowEdge patch candidate.",
            context: { plan, failedRun: result, appliedFiles: state.changedFiles, memoryContext: repairMemoryContext },
            ledger
          });
          const patch = normalizeExternalPatch(externalResult.payload, "repairer", "repair");
          if (!patch) recordExternalNormalizeFallback(ledger, "repairer", externalRepairer, "patch candidate", "native repairer");
          const candidate = patch ?? await repairer.run({ plan, failedRun: result, appliedFiles: state.changedFiles, fixtureMode: (options.provider === "fixture" || options.fixtureMode), memoryContext: repairMemoryContext });
          return applyRepairMemoryContextToCandidate(candidate, repairMemoryContext);
        }, externalRepairer ? {
          agentKind: "external",
          config,
          budgetFallback: () => repairer.run({ plan, failedRun: result, appliedFiles: state.changedFiles, fixtureMode: (options.provider === "fixture" || options.fixtureMode), memoryContext: repairMemoryContext }),
          budgetFallbackLabel: "native repairer"
        } : "offline");
        state.repairCandidates.push(repairCandidate);
        recordPatchCandidateEvent(state, ledger, "repairer", repairCandidate);
        const repairDiffRef = repairCandidate.unifiedDiff ? ledger.writeArtifact("diffs", repairCandidate.unifiedDiff) : undefined;
        const repairPrediction = recordPatchApplicationPrediction(ledger, repairCandidate, "repair", access.repairAllowed && access.repairApproved, "Repair candidate should update the files implicated by the failed verifier.");
        ledger.append({ type: "repair_attempt", phase: "repair", role: "repairer", candidateId: repairCandidate.candidateId, filesChanged: repairCandidate.filesChanged, diffRef: repairDiffRef });
        if (repairCandidate.unifiedDiff) {
          if (!contractAllowsPatchMutation(state, ledger, "repair")) return;
          try {
            const repairApplyResult = await runAgentState(state, ledger, router, "runner", () => applyUnifiedDiffWithResult(cwd, repairCandidate.unifiedDiff, access.repairAllowed && access.repairApproved), "offline");
            state.changedFiles = [...new Set([...state.changedFiles, ...repairApplyResult.changedFiles])];
            ledger.append({ type: "patch_apply", phase: "repair", role: "runner", provider: "local_tool", model: "patch", candidateId: repairCandidate.candidateId, filesChanged: repairApplyResult.changedFiles, diffRef: repairDiffRef ?? ledger.writeArtifact("diffs", repairCandidate.unifiedDiff), undoSnapshotIds: repairApplyResult.undoSnapshotIds, applied: true });
            recordOutcomeObservation(ledger, repairPrediction, "applied", `${repairApplyResult.changedFiles.length} repair file(s) changed.`);
            if (!canContinueAutonomy(config, state, ledger, startedAtMs, "shell")) return;
            if (!contractAllowsShell(state, ledger)) return;
            if (!canRunShell(config, state, shellRuns, ledger)) return;
            shellRuns += 1;
            const repairedShellPrediction = recordShellPrediction(ledger, testCommand, "Validate the repair candidate after applying it.");
            const rawRepairedRun = await runAgentState(state, ledger, router, "runner", () => runTestCommand(cwd, testCommand, shellExecutionOptions(config, access)), "offline");
            const repairedRun = normalizeVerificationResult(rawRepairedRun, { defaultVerification });
            state.runResults.push(repairedRun);
            recordShellRunEvent(state, ledger, cwd, repairedRun);
            recordOutcomeObservation(ledger, repairedShellPrediction, observedShellOutcome(repairedRun), evidenceFromRun(repairedRun), repairedRun);
            if (!repairedRun.success) {
              recordRepairPolicyDecision(state, ledger, repairedRun, failureOccurrences);
              break;
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ledger.append({ type: "repair_attempt", phase: "repair", role: "repairer", candidateId: repairCandidate.candidateId, filesChanged: repairCandidate.filesChanged, diffRef: repairDiffRef, applied: false, error: message });
            recordOutcomeObservation(ledger, repairPrediction, "blocked", message);
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
  config: TomorrowEdgeConfig;
}): Promise<PatchCandidate> {
  const externalCoder = externalProfileForRole(input.router, input.externalAgents, input.role);
  const memoryConstraints = input.state.failureMemory?.coderConstraints ?? [];
  const fallback = () => input.coder.run({
      plan: input.state.plan!,
      contextSelection: input.state.contextSelection!,
      variant: input.variant,
      fixtureMode: input.options.provider === "fixture" || input.options.fixtureMode,
      fixtureFailingPatch: input.options.fixtureFailingPatch,
      visualSpec: input.state.visualSpec,
      memoryConstraints
    });
  return runAgentState(input.state, input.ledger, input.router, input.role, async () => {
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
        variant: input.variant,
        memoryConstraints
      },
      ledger: input.ledger
    });
    const patch = normalizeExternalPatch(result.payload, input.role, input.variant === "a" ? "minimal_patch" : "alternative");
    if (!patch) recordExternalNormalizeFallback(input.ledger, input.role, externalCoder, "patch candidate", `native ${input.role}`);
    const candidate = patch ?? await fallback();
    return applyCoderConstraintsToCandidate(candidate, memoryConstraints);
  }, externalCoder ? {
    agentKind: "external",
    config: input.config,
    budgetFallback: fallback,
    budgetFallbackLabel: `native ${input.role}`
  } : "offline");
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
  const profile = registry.get(externalAgentId);
  if (!profile?.allowedRoles.includes(role)) return undefined;
  return profile;
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
    acceptedClaims: stringArray(object.acceptedClaims),
    rejectedClaims: stringArray(object.rejectedClaims),
    unresolvedBlockingIssues: stringArray(object.unresolvedBlockingIssues),
    evidenceCoverageScore: typeof object.evidenceCoverageScore === "number" ? boundedNumber(object.evidenceCoverageScore, 0) : undefined,
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
    notes: stringArray(object.notes),
    memoryViolations: stringArray(object.memoryViolations),
    memoryAlignment: stringArray(object.memoryAlignment),
    memoryIds: stringArray(object.memoryIds)
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

async function finalizeState(runtime: OfflineGraphRuntime, state: AgentGraphState): Promise<AgentGraphState> {
  const { ledger, router } = runtime;
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
      }),
      "offline"
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.finalSummary = {
      task: state.goal,
      result: state.runResults.some((result) => !result.success) ? "partially_completed" : "completed",
      userReply: `I finished the workflow, but the summarizer failed before it could produce a polished answer. ${state.changedFiles.length ? `Changed files: ${state.changedFiles.join(", ")}.` : "No files were changed."}`,
      userReplySource: "system",
      changedFiles: state.changedFiles,
      testsRun: state.runResults.map((result) => result.command),
      evidence: ["summarizer failed; system diagnostic summary generated", ...state.runResults.map(evidenceFromRun)],
      risksRemaining: [`summarizer failed: ${message}`],
      suggestedCommitMessage: `chore: update ${state.changedFiles[0] ?? "workspace"}`
    };
  }
  await appendFinalSummaryEvents(state, ledger, runtime);
  await releaseExternalAgentProcessPool();
  return state;
}

async function finalizeBlockedByContract(runtime: OfflineGraphRuntime, state: AgentGraphState, reason: string): Promise<AgentGraphState> {
  const { ledger } = runtime;
  state.finalSummary = {
    task: state.goal,
    result: "aborted",
    userReply: `I blocked this task before execution because the Objective Contract failed verification. ${reason}`,
    userReplySource: "blocked",
    changedFiles: [],
    testsRun: [],
    evidence: [
      reason,
      ...(state.contractVerification?.violations ?? []),
      ...(state.contractVerification?.missing ?? []).map((item) => `Missing contract field: ${item}`)
    ],
    risksRemaining: ["unsafe/blocked/advisory: objective contract failed verification, so execution was not started."],
    suggestedCommitMessage: "chore: no code changes"
  };
  ledger.append({
    type: "agent_run",
    phase: "planning",
    role: "planner",
    provider: "local_tool",
    model: "contract_gate",
    agentKind: "offline",
    status: "blocked",
    runId: "objective_contract_gate",
    error: reason
  });
  await appendFinalSummaryEvents(state, ledger, runtime);
  await releaseExternalAgentProcessPool();
  return state;
}

async function finalizeReadOnlyState(runtime: OfflineGraphRuntime, state: AgentGraphState): Promise<AgentGraphState> {
  const { cwd, ledger, router } = runtime;
  const result = await runAgentState(state, ledger, router, "summarizer", () =>
    buildReadOnlyTaskResult(cwd, state.plan!, state.contextSelection)
  , "offline");
  const evidenceRef = ledger.writeArtifact("summaries", result.artifactText);
  const reply = await buildReadOnlyUserReply(runtime, state, result);
  const replyRef = ledger.writeArtifact("summaries", reply.text);
  ledger.append({
    type: "evidence_update",
    phase: "summary",
    role: "summarizer",
    evidence: [reply.source === "model" ? "user-facing reply generated by model" : `user-facing reply blocked: ${reply.error ?? "model answer unavailable"}`, ...result.evidence.slice(0, 2)],
    evidenceRef
  });
  ledger.append({
    type: "evidence_update",
    phase: "summary",
    role: "summarizer",
    provider: reply.provider,
    model: reply.model,
    evidence: [reply.text],
    evidenceRef: replyRef
  });
  state.finalSummary = {
    task: state.goal,
    result: reply.source === "model" ? "completed" : "failed",
    userReply: reply.text,
    userReplySource: reply.source,
    changedFiles: [],
    testsRun: [],
    evidence: result.evidence,
    risksRemaining: reply.source === "model" ? [] : [reply.error ?? "No model-backed user reply was produced."],
    suggestedCommitMessage: "chore: no code changes"
  };
  await appendFinalSummaryEvents(state, ledger, runtime);
  await releaseExternalAgentProcessPool();
  return state;
}

type UserReplyGeneration = {
  text: string;
  source: NonNullable<FinalSummary["userReplySource"]>;
  provider?: string;
  model?: string;
  error?: string;
};

async function buildReadOnlyUserReply(
  runtime: OfflineGraphRuntime,
  state: AgentGraphState,
  result: Awaited<ReturnType<typeof buildReadOnlyTaskResult>>
): Promise<UserReplyGeneration> {
  const assignment = runtime.router.assignmentFor("summarizer");
  if (assignment.provider === "local_tool" || assignment.provider.startsWith("external:")) {
    const error = `Summarizer route ${assignment.provider}/${assignment.model} cannot produce a direct model-backed natural-language answer.`;
    return {
      text: `${error} Configure an answer-capable model provider for the summarizer role and rerun the request.`,
      source: "blocked",
      provider: assignment.provider,
      model: assignment.model,
      error
    };
  }

  const providerResult = await chatWithProviderFallback({
    config: runtime.config,
    router: runtime.router,
    role: "summarizer",
    provider: assignment.provider,
    model: assignment.model,
    ledger: runtime.ledger,
    allowFallback: false,
    markProviderUnavailable: false,
    buildRequest: (model) => ({
      model,
      temperature: 0.2,
      maxCompletionTokens: 900,
      responseFormat: { type: "text" },
      metadata: { tomorrowedgeTask: "user_reply" },
      messages: [
        {
          role: "system",
          content: [
            "You are TomorrowEdge's user-facing answer writer.",
            "Answer the user's request directly and concisely.",
            "Do not lead with internal workflow, telemetry, routing, or trace details.",
            "If local evidence is insufficient, say that clearly and provide the best actionable handoff.",
            "Do not claim that files were edited, shell commands were run, or tests passed unless the evidence says so."
          ].join("\n")
        },
        {
          role: "user",
          content: [
            `User request:\n${state.goal}`,
            "",
            `Workflow kind: ${state.workflowKind ?? state.plan?.workflowKind ?? "read_only"}`,
            `Selected context summary: ${state.contextSelection?.contextSummary ?? "none"}`,
            "",
            "Local read-only evidence preview:",
            clipForPrompt(result.artifactText, 3500)
          ].join("\n")
        }
      ]
    })
  });
  const modelText = extractUserReplyText(providerResult.response?.content);
  if (modelText) {
    return {
      text: modelText,
      source: "model",
      provider: providerResult.provider,
      model: providerResult.model
    };
  }
  const error = providerResult.error ?? "Provider returned an empty answer.";
  return {
    text: `No model-backed user answer was produced. ${error}`,
    source: "blocked",
    provider: providerResult.provider,
    model: providerResult.model,
    error
  };
}

function extractUserReplyText(content?: string): string | undefined {
  const trimmed = content?.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      for (const key of ["userReply", "answer", "reply", "summary"]) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
    }
  } catch {
    // Plain text is the preferred provider output for user-facing replies.
  }
  return trimmed.replace(/^```(?:\w+)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function clipForPrompt(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n... omitted ${value.length - maxChars} character(s)`;
}

async function appendFinalSummaryEvents(state: AgentGraphState, ledger: EventLedger, runtime: OfflineGraphRuntime): Promise<void> {
  if (!state.finalSummary) throw new Error("Cannot finalize workflow without a final summary.");
  refreshUsageSummary(state);
  const workflowKind = state.workflowKind ?? inferWorkflowKindFromEvents(ledger.events, state.plan);
  applyPolicyStopDecision(state, computeProjectedTraceCompleteness(ledger.events, workflowKind, state.plan));
  ledger.append({
    type: "cost_usage",
    phase: "summary",
    role: "summarizer",
    inputTokens: state.usageSummary.inputTokens,
    outputTokens: state.usageSummary.outputTokens,
    totalTokens: state.usageSummary.totalTokens,
    estimatedCostUsd: state.usageSummary.estimatedCostUsd
  });
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
  state.traceCompleteness = computeTraceCompleteness(ledger.events, { workflowKind, plan: state.plan });
  ledger.append({
    type: "trace_completeness",
    phase: "summary",
    role: "summarizer",
    score: state.traceCompleteness.score,
    missing: state.traceCompleteness.missing,
    workflowKind
  });
  await writeObjectiveTraceAndPolicyEvents(state, ledger, runtime);
}

function computeProjectedTraceCompleteness(events: TomorrowEdgeEvent[], workflowKind: ReturnType<typeof inferWorkflowKindFromEvents>, plan?: Plan) {
  return computeTraceCompleteness([
    ...events,
    { type: "summary" } as TomorrowEdgeEvent,
    { type: "workflow_stop_reason" } as TomorrowEdgeEvent
  ], { workflowKind, plan });
}

function applyPolicyStopDecision(state: AgentGraphState, projectedCompleteness: ReturnType<typeof computeTraceCompleteness>): void {
  if (!state.finalSummary) return;
  const policy = state.orchestrationPolicy;
  if (state.contractVerification?.status === "failed") {
    state.finalSummary = {
      ...state.finalSummary,
      result: "aborted",
      risksRemaining: uniqueStrings([...state.finalSummary.risksRemaining, "Objective contract verification failed; execution was blocked as unsafe/blocked/advisory."])
    };
    return;
  }
  if (!policy || state.finalSummary.result === "aborted" || state.finalSummary.result === "failed") return;
  const required = state.objectiveContract?.requiredEvidence ?? [];
  const satisfied = state.objectiveContract ? satisfiedEvidence(required, state) : [];
  const evidenceRatio = required.length ? satisfied.length / required.length : 1;
  const threshold = requiredEvidenceThreshold(policy);
  const traceThreshold = traceCompletenessThreshold(policy);
  const reasons: string[] = [];
  if (evidenceRatio < threshold) reasons.push(`required evidence ratio ${evidenceRatio.toFixed(2)} is below policy threshold ${threshold.toFixed(2)}`);
  if (projectedCompleteness.score < traceThreshold) reasons.push(`trace completeness ${projectedCompleteness.score} is below policy threshold ${traceThreshold}`);
  if (policyStopMode(policy) === "evidence_strict" && state.runResults.some((result) => !result.success && !result.skipped)) {
    reasons.push("evidence_strict stop policy found failed verification evidence");
  }
  if (!policyAllowsPartialCompletion(policy) && state.finalSummary.result === "partially_completed") {
    reasons.push("partial completion is disabled by stopPolicy.allowPartialCompletion=false");
  }
  if (!reasons.length) return;
  const downgradedResult = policyAllowsPartialCompletion(policy) && policyStopMode(policy) !== "evidence_strict" ? "partially_completed" : "failed";
  state.finalSummary = {
    ...state.finalSummary,
    result: downgradedResult,
    risksRemaining: uniqueStrings([...state.finalSummary.risksRemaining, ...reasons])
  };
}

async function writeObjectiveTraceAndPolicyEvents(state: AgentGraphState, ledger: EventLedger, runtime: OfflineGraphRuntime): Promise<void> {
  if (!state.scenarioProfile || !state.objectiveContract || !state.contractVerification) return;
  const trace = buildObjectiveTrace(state, runtime);
  state.objectiveTrace = trace;
  const traceRef = ledger.writeArtifact("objective_traces", JSON.stringify(trace, null, 2), "json");
  await addTrace(runtime.cwd, trace);
  ledger.append({
    type: "objective_trace_written",
    phase: "memory",
    role: "summarizer",
    traceId: trace.traceId,
    traceRef,
    outcomeStatus: trace.outcome.finalStatus,
    evidenceScore: trace.evidenceSummary.evidenceScore
  });
  if (state.orchestrationPolicy) {
    const fitness = evaluatePolicyFitness(state.orchestrationPolicy, trace, state);
    const scoredPolicy = policyWithFitness({
      ...state.orchestrationPolicy,
      metadata: {
        ...state.orchestrationPolicy.metadata,
        scenarioType: state.scenarioProfile.scenarioType
      }
    }, fitness);
    state.orchestrationPolicy = scoredPolicy;
    ledger.append({
      type: "orchestration_policy_scored",
      phase: "memory",
      role: "summarizer",
      policyId: scoredPolicy.policyId,
      finalFitness: fitness.finalFitness,
      fitnessRef: ledger.writeArtifact("policy_fitness", JSON.stringify(fitness, null, 2), "json")
    });
    await savePolicyScore(runtime.cwd, scoredPolicy);
    await maybeRecordPolicyEvolution(runtime, state, trace, scoredPolicy);
  }
}

async function maybeRecordPolicyEvolution(runtime: OfflineGraphRuntime, state: AgentGraphState, trace: ObjectiveTraceV1, policy: OrchestrationPolicyGenome): Promise<void> {
  const { config, ledger } = runtime;
  const mode = selfIterationMode(config);
  const enabled = mode === "offline_evolution" || (mode === "experimental_online" && config.self_iterating_orchestration.allow_policy_mutation);
  if (!enabled || !config.self_iterating_orchestration.allow_offline_evolution) return;
  const result = evolvePoliciesOffline({
    basePolicy: policy,
    traces: [trace, ...(state.retrievedObjectiveTraces ?? [])],
    maxPolicyVariants: config.self_iterating_orchestration.max_policy_variants,
    eliteRetention: config.self_iterating_orchestration.elite_retention
  });
  for (const variant of result.variants) {
    ledger.append({
      type: "policy_mutation",
      phase: "memory",
      role: "planner",
      parentPolicyId: policy.policyId,
      policyId: variant.policyId,
      mutationRef: ledger.writeArtifact("policy_mutations", JSON.stringify(variant, null, 2), "json")
    });
  }
  ledger.append({
    type: "policy_evolution",
    phase: "memory",
    role: "planner",
    selectedPolicyIds: result.selected.map((item) => item.policyId),
    evaluatedCount: result.scored.length,
    evolutionRef: ledger.writeArtifact("policy_evolution", JSON.stringify(result, null, 2), "json")
  });
  for (const replayPolicy of [policy, ...result.variants].slice(0, 5)) {
    const replay = simulatePolicyOnTrace(replayPolicy, trace, policy);
    ledger.append({
      type: "policy_counterfactual_replay",
      phase: "memory",
      role: "planner",
      policyId: replay.policyId,
      traceId: replay.traceId,
      simulatedStatus: replay.simulatedStatus,
      fitnessDelta: replay.deltas.finalFitness ?? 0,
      summary: replay.summary,
      replayRef: ledger.writeArtifact("policy_counterfactual", JSON.stringify(replay, null, 2), "json")
    });
  }
  ledger.append({
    type: "policy_tournament_result",
    phase: "memory",
    role: "planner",
    winnerPolicyId: result.tournament.winnerPolicyId,
    evaluatedPolicies: result.tournament.evaluatedPolicies,
    traceCount: result.tournament.traceCount,
    tournamentRef: ledger.writeArtifact("policy_tournaments", JSON.stringify(result.tournament, null, 2), "json")
  });
  for (const selected of result.selected) await savePolicyScore(runtime.cwd, selected);
}

function buildObjectiveTrace(state: AgentGraphState, runtime: OfflineGraphRuntime): ObjectiveTraceV1 {
  const contract = state.objectiveContract!;
  const verification = state.contractVerification!;
  const scenarioProfile = state.scenarioProfile!;
  const evidenceRefs = collectEvidencePacketRefs(state);
  const requiredEvidenceSatisfied = satisfiedEvidence(contract.requiredEvidence, state);
  const missingEvidence = contract.requiredEvidence.filter((item) => !requiredEvidenceSatisfied.includes(item));
  const finalStatus = finalTraceStatus(state);
  return {
    schemaVersion: "objective-trace/v1",
    traceId: makeId("objective_trace"),
    runId: state.sessionId,
    createdAt: nowIso(),
    goal: state.goal,
    scenarioProfile,
    policySummary: policySummaryForTrace(state.orchestrationPolicy),
    contract,
    contractVerification: verification,
    planSummary: {
      workflowKind: state.workflowKind ?? workflowKindFromPlan(state.plan),
      steps: state.plan?.steps.map((step) => step.title) ?? [],
      allowedPhases: state.plan?.allowedPhases ?? contract.allowedPhases,
      verificationCommands: state.plan?.verificationCommands ?? []
    },
    roleGraphSummary: {
      rolesUsed: uniqueAgentRoles(state.agents.map((agent) => agent.role)),
      routingDecisions: state.routing.assignments.map((assignment) => `${assignment.role}->${assignment.provider}/${assignment.model}: ${assignment.reason}`),
      fallbackDecisions: state.events.filter((event) => event.type === "fallback_to_native" || event.type === "provider_fallback").map((event) => eventSummaryForTrace(event))
    },
    executionSummary: {
      actions: state.events.filter((event) => ["patch_candidate", "patch_apply", "shell_run", "repair_attempt", "review_decision", "judge_decision"].includes(event.type)).map(eventSummaryForTrace),
      toolCalls: state.events.filter((event) => ["file_read", "shell_run", "patch_apply", "context_select"].includes(event.type)).map(eventSummaryForTrace),
      observations: state.events.filter((event) => event.type === "outcome_observation").map(eventSummaryForTrace),
      shellRuns: state.runResults.length,
      filesTouched: state.changedFiles
    },
    toolUsage: buildToolUsageForTrace(state),
    evidenceSummary: {
      evidencePacketRefs: evidenceRefs,
      requiredEvidenceSatisfied,
      missingEvidence,
      evidenceScore: evidenceScore(requiredEvidenceSatisfied.length, contract.requiredEvidence.length, verification)
    },
    verificationSummary: {
      status: finalStatus === "success" ? "success" : finalStatus === "partial" ? "partial" : finalStatus === "unsafe" ? "unsafe" : finalStatus === "failure" ? "failure" : "uncertain",
      passedCriteria: finalStatus === "success" ? contract.successCriteria : [],
      failedCriteria: finalStatus === "success" ? [] : contract.failureCriteria,
      reviewerDecision: state.review?.overallRecommendation,
      judgeDecision: state.judge?.decision
    },
    repairSummary: {
      repairAttempts: state.repairCandidates.length,
      recovered: state.repairCandidates.length > 0 && state.runResults.at(-1)?.success === true,
      recurringFailurePattern: state.events.find((event) => event.type === "repair_policy" && event.occurrence > 1 && "failureSignature" in event)?.type === "repair_policy"
        ? (state.events.find((event) => event.type === "repair_policy" && event.occurrence > 1) as Extract<typeof state.events[number], { type: "repair_policy" }>).failureSignature
        : undefined
    },
    costSummary: {
      tokens: state.usageSummary.totalTokens,
      toolCalls: state.events.filter((event) => ["file_read", "shell_run", "patch_apply", "context_select"].includes(event.type)).length,
      shellRuns: state.runResults.length,
      wallTimeMs: Date.now() - runtime.startedAtMs,
      estimatedCostUsd: state.usageSummary.estimatedCostUsd
    },
    feedback: {
      implicitSignals: implicitFeedbackSignals(state)
    },
    traceCompleteness: state.traceCompleteness
      ? { score: state.traceCompleteness.score, missing: state.traceCompleteness.missing }
      : undefined,
    outcome: {
      finalStatus,
      failureType: finalStatus === "success" ? undefined : workflowStopReason(state),
      lessons: objectiveTraceLessons(state, missingEvidence)
    }
  };
}

function buildToolUsageForTrace(state: AgentGraphState): NonNullable<ObjectiveTraceV1["toolUsage"]> {
  const selectedSkills = new Map((state.toolSkillRoutes ?? []).filter((route) => route.selected).map((route) => [route.skillId, route]));
  const usage: NonNullable<ObjectiveTraceV1["toolUsage"]> = [];
  for (const event of state.events) {
    if (event.type === "context_select") {
      usage.push({
        toolId: "repo_index",
        skillId: selectedSkillForTool(selectedSkills, "repo_index"),
        version: "1.0.0",
        phase: event.phase,
        role: event.role,
        permissionIntents: ["read"],
        outcome: "success",
        artifactRefs: [],
        pathRefs: event.selectedFiles
      });
    }
    if (event.type === "file_read") {
      usage.push({
        toolId: "file_read",
        skillId: selectedSkillForTool(selectedSkills, "file_read"),
        version: "1.0.0",
        phase: event.phase,
        role: event.role,
        permissionIntents: ["read"],
        outcome: "success",
        artifactRefs: [],
        pathRefs: [event.path]
      });
    }
    if (event.type === "patch_candidate") {
      usage.push({
        toolId: "patch_candidate",
        skillId: selectedSkillForTool(selectedSkills, "patch_candidate"),
        version: "1.0.0",
        phase: event.phase,
        role: event.role,
        permissionIntents: ["write"],
        outcome: "success",
        artifactRefs: event.diffRef ? [event.diffRef] : [],
        pathRefs: event.filesChanged
      });
    }
    if (event.type === "patch_apply") {
      usage.push({
        toolId: "patch_apply",
        skillId: selectedSkillForTool(selectedSkills, "patch_apply"),
        version: "1.0.0",
        phase: event.phase,
        role: event.role,
        permissionIntents: ["write"],
        outcome: event.applied ? "success" : event.error ? "failure" : "blocked",
        artifactRefs: [event.diffRef],
        pathRefs: event.filesChanged
      });
    }
    if (event.type === "shell_run") {
      usage.push({
        toolId: "shell",
        skillId: selectedSkillForTool(selectedSkills, "shell") ?? shellSkillForCommand(event.command),
        version: "1.0.0",
        phase: event.phase,
        role: event.role,
        permissionIntents: ["shell"],
        outcome: event.success === true ? "success" : event.success === false ? "failure" : event.error ? "blocked" : "unknown",
        artifactRefs: [event.stdoutRef, event.stderrRef].filter((item): item is string => Boolean(item)),
        command: event.command,
        durationMs: event.durationMs,
        exitCode: event.exitCode
      });
    }
  }
  return usage;
}

function selectedSkillForTool(selectedSkills: Map<string, { requiredTools: string[]; skillId: string }>, toolId: string): string | undefined {
  return [...selectedSkills.values()].find((route) => route.skillId === toolId || route.requiredTools.includes(toolId))?.skillId;
}

function shellSkillForCommand(command: string): string {
  const normalized = command.toLowerCase();
  if (normalized.includes("lint")) return "code.run_lint";
  if (normalized.includes("typecheck") || normalized.includes("tsc")) return "code.run_typecheck";
  if (normalized.includes("test") || normalized.includes("vitest") || normalized.includes("pytest")) return "code.run_tests";
  return "shell";
}

function policySummaryForTrace(policy?: OrchestrationPolicyGenome): ObjectiveTraceV1["policySummary"] {
  if (!policy) return undefined;
  return {
    policyId: policy.policyId,
    schemaVersion: policy.schemaVersion,
    source: policy.metadata.source,
    scenarioType: policy.metadata.scenarioType,
    mutation: policy.metadata.mutation,
    fitness: policy.metadata.fitness,
    contractDepth: policy.contractPolicy.contractDepth,
    traceTopK: policy.tracePolicy.traceTopK,
    preferRecent: policy.tracePolicy.preferRecent,
    preferSuccessTraces: policy.tracePolicy.preferSuccessTraces,
    preferFailureTraces: policy.tracePolicy.preferFailureTraces,
    avoidStaleTraces: policy.tracePolicy.avoidStaleTraces,
    maxStepsMode: policy.planningPolicy.maxStepsMode,
    allowParallelRoles: policy.planningPolicy.allowParallelRoles,
    routingPreference: policy.routingPolicy.routingPreference,
    reviewerThreshold: policy.routingPolicy.reviewerThreshold,
    judgeThreshold: policy.routingPolicy.judgeThreshold,
    toolRoutingPreference: policy.toolRoutingPolicy.preference,
    allowCandidateSkills: policy.toolRoutingPolicy.allowCandidateSkills,
    requireSkillValidation: policy.toolRoutingPolicy.requireValidation,
    verificationStrictness: policy.verificationPolicy.verificationStrictness,
    maxRepairRounds: policy.repairPolicy.maxRepairRounds,
    stopMode: policy.stopPolicy.stopMode,
    allowPartialCompletion: policy.stopPolicy.allowPartialCompletion
  };
}

function finalTraceStatus(state: AgentGraphState): ObjectiveTraceV1["outcome"]["finalStatus"] {
  if (state.contractVerification?.status === "failed") return "unsafe";
  if (state.finalSummary?.result === "completed") return "success";
  if (state.finalSummary?.result === "failed") return "failure";
  if (state.finalSummary?.result === "aborted") return "aborted";
  return "partial";
}

function collectEvidencePacketRefs(state: AgentGraphState): string[] {
  return state.events
    .filter((event) => event.type === "evidence_packet")
    .map((event) => event.type === "evidence_packet" ? event.packetRef : "")
    .filter(Boolean);
}

function satisfiedEvidence(requiredEvidence: string[], state: AgentGraphState): string[] {
  const eventTypes = new Set(state.events.map((event) => event.type));
  const artifacts = state.eventArtifacts.map((artifact) => artifact.ref).join("\n").toLowerCase();
  return requiredEvidence.filter((item) => {
    const normalized = item.toLowerCase();
    if (normalized.includes("contract")) return eventTypes.has("objective_contract") && eventTypes.has("contract_verification");
    if (normalized.includes("patch") || normalized.includes("diff")) return eventTypes.has("patch_candidate") || artifacts.includes("diffs/");
    if (normalized.includes("review")) return eventTypes.has("review_decision");
    if (normalized.includes("judge")) return eventTypes.has("judge_decision");
    if (normalized.includes("shell") || normalized.includes("verification") || normalized.includes("verifier")) return eventTypes.has("shell_run") || state.runResults.length > 0 || state.plan?.requiresPatchWorkflow === false;
    if (normalized.includes("evidence packet")) return eventTypes.has("evidence_packet") || state.evidencePackets.length > 0;
    if (normalized.includes("trace completeness")) return eventTypes.has("trace_completeness") || Boolean(state.traceCompleteness) || Boolean(state.finalSummary);
    if (normalized.includes("objective-action-feedback trace")) return eventTypes.has("objective_trace_written") || Boolean(state.objectiveTrace) || Boolean(state.finalSummary);
    if (normalized.includes("workflow stop reason")) return eventTypes.has("workflow_stop_reason") || Boolean(state.finalSummary);
    if (normalized.includes("artifact projection")) return eventTypes.has("artifact_projection") || state.providerViews.length > 0;
    if (normalized.includes("summary")) return Boolean(state.finalSummary);
    if (normalized.includes("event ledger")) return state.events.length > 0;
    if (normalized.includes("objective")) return eventTypes.has("objective_contract");
    return Boolean(state.finalSummary);
  });
}

function evidenceScore(satisfied: number, required: number, verification: NonNullable<AgentGraphState["contractVerification"]>): number {
  const ratio = required ? satisfied / required : 1;
  return Math.max(0, Math.min(100, Math.round(ratio * 75 + verification.score * 0.25)));
}

function implicitFeedbackSignals(state: AgentGraphState): string[] {
  const signals: string[] = [];
  if (state.access.patchApproved) signals.push("patch_approved");
  if (state.access.shellApproved) signals.push("shell_approved");
  if (state.runResults.some((result) => result.success)) signals.push("verification_passed");
  if (state.events.some((event) => event.type === "fallback_to_native" || event.type === "provider_fallback")) signals.push("fallback_used");
  return signals;
}

function objectiveTraceLessons(state: AgentGraphState, missingEvidence: string[]): string[] {
  const lessons = [
    `Contract-first workflow kind: ${state.workflowKind ?? workflowKindFromPlan(state.plan)}.`,
    state.finalSummary?.result ? `Final status: ${state.finalSummary.result}.` : "Final summary missing."
  ];
  if (missingEvidence.length) lessons.push(`Missing evidence next time: ${missingEvidence.join(", ")}.`);
  const failedRun = state.runResults.find((result) => !result.success && !result.skipped);
  if (failedRun) lessons.push(`Verification failed on ${failedRun.command}; route repair with stdout/stderr evidence.`);
  return lessons;
}

function uniqueAgentRoles(values: AgentRole[]): AgentRole[] {
  return [...new Set(values)];
}

function eventSummaryForTrace(event: TomorrowEdgeEvent): string {
  if (event.type === "patch_candidate") return `patch_candidate:${event.candidateId}:${event.summary}`;
  if (event.type === "patch_apply") return `patch_apply:${event.applied ? "applied" : "blocked"}:${event.candidateId}`;
  if (event.type === "shell_run") return `shell_run:${event.command}:success=${event.success}`;
  if (event.type === "review_decision") return `review:${event.recommendation}`;
  if (event.type === "judge_decision") return `judge:${event.decision}:${event.selectedCandidateId ?? "-"}`;
  if (event.type === "fallback_to_native") return `fallback_to_native:${event.fallbackRole}:${event.reason}`;
  if (event.type === "provider_fallback") return `provider_fallback:${event.fromProvider}->${event.toProvider}:${event.reason}`;
  if (event.type === "context_select") return `context_select:${event.selectedFiles.length} files`;
  if (event.type === "file_read") return `file_read:${event.path}`;
  if (event.type === "outcome_observation") return `observation:${event.target}:${event.observedOutcome}:${event.mismatchType}`;
  return `${event.type}:${event.phase}`;
}

function workflowStopReason(state: AgentGraphState): string {
  if (state.finalSummary?.result === "failed" && state.finalSummary.userReplySource === "blocked") return "model-backed answer unavailable; workflow blocked without fallback";
  if (state.finalSummary?.result === "failed") return "workflow failed before completion";
  if (state.finalSummary?.result === "aborted") return "workflow aborted before execution";
  if (state.plan && isReadOnlyPlan(state.plan) && !state.candidates.length && !state.changedFiles.length) return "read-only request completed without patch workflow";
  if (state.judge?.decision === "abort") return "judge aborted workflow";
  if (state.judge?.decision === "ask_user") return "judge requested user decision";
  const latestRun = state.runResults.at(-1);
  if (latestRun && !latestRun.success) return "verification failed or repair budget ended";
  if (latestRun?.success && state.repairCandidates.length) return "repair applied and verification passed";
  if (state.changedFiles.length) return "selected patch applied and workflow finalized";
  return "no patch applied; workflow finalized after review and judge";
}

function applyTaskGovernanceToPlan(plan: Plan, governance: NonNullable<AgentGraphState["taskGovernance"]>): Plan {
  const elevated = governance.requiresReviewer || governance.requiresJudge || governance.reasoningSensitivity !== "low";
  if (!elevated) return plan;
  const riskLevel = governance.reasoningSensitivity === "high" ? "high" : plan.riskLevel === "low" ? "medium" : plan.riskLevel;
  return {
    ...plan,
    riskLevel,
    workflowKind: plan.requiresPatchWorkflow === false || plan.taskType === "analysis" ? "advisory" : plan.workflowKind,
    debateRecommended: true,
    reasonForDebate: `Task governance requires independent review/judge: ${governance.reason}`
  };
}

function applyPolicyGovernanceToPlan(plan: Plan, policy?: OrchestrationPolicyGenome): Plan {
  if (!policy) return plan;
  if (!policy.planningPolicy.allowParallelRoles) return { ...plan, debateRecommended: false, reasonForDebate: undefined };
  const patchLike = plan.requiresPatchWorkflow !== false && plan.taskType !== "analysis";
  const requiresReviewer = shouldPolicyRequireReviewer(policy, plan.riskLevel, patchLike);
  const requiresJudge = shouldPolicyRequireJudge(policy, plan.riskLevel, patchLike);
  if (!requiresReviewer && !requiresJudge) return plan;
  return {
    ...plan,
    debateRecommended: true,
    reasonForDebate: plan.reasonForDebate ?? `Orchestration policy escalated governance: reviewerThreshold=${policy.routingPolicy.reviewerThreshold}, judgeThreshold=${policy.routingPolicy.judgeThreshold}.`
  };
}

function enforceParallelRolePolicy(plan: Plan, policy?: OrchestrationPolicyGenome): Plan {
  if (policy?.planningPolicy.allowParallelRoles !== false) return plan;
  return { ...plan, debateRecommended: false, reasonForDebate: undefined };
}

function parallelRolesAllowed(state: AgentGraphState): boolean {
  return state.orchestrationPolicy?.planningPolicy.allowParallelRoles !== false;
}

async function maybeRunGovernedReadOnlyAdvisory(input: {
  cwd: string;
  goal: string;
  config: TomorrowEdgeConfig;
  router: ModelRouter;
  ledger: EventLedger;
  state: AgentGraphState;
  access: AgentGraphState["access"];
}): Promise<void> {
  const governance = input.state.taskGovernance;
  const shouldAdvise = Boolean(governance && (governance.requiresReviewer || governance.requiresJudge || governance.reasoningSensitivity !== "low"));
  if (!shouldAdvise) return;
  if (!input.access.cloudAllowed) {
    input.ledger.append({
      type: "evidence_update",
      phase: "planning",
      role: "planner",
      evidence: [`Governance advisory required but blocked by access mode ${input.access.mode}.`, governance?.reason ?? ""]
    });
    return;
  }
  const advisoryInput = {
    cwd: input.cwd,
    goal: input.goal,
    config: input.config,
    router: input.router,
    plan: input.state.plan,
    candidates: input.state.candidates,
    review: input.state.review,
    visualSpec: input.state.visualSpec,
    ledger: input.ledger,
    governance
  };
  const advisoryPlans = buildAdvisoryPlans(advisoryInput);
  const budgetStatus = setBudgetStatus(input.state, preflightBudget(
    advisoryPlans.map((plan) => ({ provider: plan.provider, prompt: plan.prompt, maxOutputTokens: plan.maxOutputTokens })),
    input.config.routing.max_cost_usd
  ));
  recordLiveBudgetDecisions(input.ledger, "planning", advisoryPlans, budgetStatus);
  if (budgetStatus.status === "blocked") {
    input.ledger.append({ type: "autonomy_limit_reached", phase: "planning", status: "blocked_by_budget", reason: budgetStatus.reason });
    return;
  }
  const advisoryNotes = await runLiveAdvisory(advisoryInput);
  input.state.modelNotes.push(...advisoryNotes);
  refreshUsageSummary(input.state);
  recordModelNoteEvents(input.ledger, advisoryNotes, input.state.usageSummary);
  recordGovernedReadOnlyAdvisoryEvidence(input.state, input.ledger, advisoryNotes);
}

function recordGovernedReadOnlyAdvisoryEvidence(state: AgentGraphState, ledger: EventLedger, notes: ModelNote[]): void {
  const reviewerNote = notes.find((note) => note.role === "reviewer" && !note.error && note.content.trim());
  const judgeNote = notes.find((note) => note.role === "judge" && !note.error && note.content.trim());
  const supportingArtifacts: string[] = [];
  if (reviewerNote) {
    const reviewRef = ledger.writeArtifact("reviews", reviewerNote.content);
    supportingArtifacts.push(reviewRef);
    ledger.append({
      type: "review_decision",
      phase: "review",
      role: "reviewer",
      provider: reviewerNote.provider,
      model: reviewerNote.model,
      reviewRef,
      recommendation: "read_only_review_complete"
    });
  }
  if (judgeNote) {
    const decisionRef = ledger.writeArtifact("judgments", judgeNote.content);
    supportingArtifacts.push(decisionRef);
    ledger.append({
      type: "judge_decision",
      phase: "judge",
      role: "judge",
      provider: judgeNote.provider,
      model: judgeNote.model,
      decision: "accept_read_only_answer",
      reason: clipForPrompt(judgeNote.content, 600),
      confidence: 0.75,
      decisionRef
    });
  }
  if (!supportingArtifacts.length) return;
  const packet: EvidencePacket = {
    id: makeId("evidence_readonly"),
    phase: reviewerNote ? "review" : "judge",
    summary: "Governed read-only advisory evidence recorded for a user-facing answer.",
    claims: [
      "The workflow remained read-only.",
      "Reviewer/judge advisory evidence was collected before final answer presentation."
    ],
    supportingArtifacts,
    riskSignals: state.taskGovernance?.reasoningSensitivity === "high" ? ["high reasoning sensitivity"] : [],
    verificationStatus: "partial",
    modelVisibleText: [
      "Read-only advisory evidence:",
      reviewerNote?.content,
      judgeNote?.content
    ].filter(Boolean).join("\n\n")
  };
  state.evidencePackets.push(packet);
  ledger.append({
    type: "evidence_packet",
    phase: "review",
    role: "reviewer",
    packetId: packet.id,
    evidencePhase: packet.phase,
    summary: packet.summary,
    verificationStatus: packet.verificationStatus,
    supportingArtifacts,
    packetRef: ledger.writeArtifact("evidence", JSON.stringify(packet, null, 2), "json")
  });
}

function normalizeCandidateAgentOrder(state: AgentGraphState, startIndex: number, labels: string[]): void {
  const roleOrder = new Map<AgentRole, number>();
  for (const [index, label] of labels.entries()) {
    if (label === "coder_a" || label === "coder_b") roleOrder.set(label, index);
  }
  if (!roleOrder.size || startIndex >= state.agents.length) return;
  const before = state.agents.slice(0, startIndex);
  const candidateStage = state.agents.slice(startIndex);
  candidateStage.sort((left, right) => {
    const leftOrder = roleOrder.get(left.role) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = roleOrder.get(right.role) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.id.localeCompare(right.id);
  });
  state.agents = [...before, ...candidateStage];
}

async function maybeRunPreJudgeModelDebate(input: {
  cwd: string;
  goal: string;
  config: TomorrowEdgeConfig;
  router: ModelRouter;
  ledger: EventLedger;
  state: AgentGraphState;
  access: AgentGraphState["access"];
  options: OfflineGraphOptions;
}): Promise<void> {
  if (!input.options.liveAdvisory || !input.access.cloudAllowed) return;
  const advisoryInput = {
    cwd: input.cwd,
    goal: input.goal,
    config: input.config,
    router: input.router,
    plan: input.state.plan,
    candidates: input.state.candidates,
    review: input.state.review,
    visualSpec: input.state.visualSpec,
    ledger: input.ledger,
    governance: input.state.taskGovernance
  };
  const roles: AgentRole[] = ["reviewer", "judge"];
  const advisoryPlans = buildAdvisoryPlans(advisoryInput).filter((plan) => roles.includes(plan.role));
  if (!advisoryPlans.length) return;
  const budgetStatus = setBudgetStatus(input.state, preflightBudget(
    advisoryPlans.map((plan) => ({ provider: plan.provider, prompt: plan.prompt, maxOutputTokens: plan.maxOutputTokens })),
    input.config.routing.max_cost_usd
  ));
  recordLiveBudgetDecisions(input.ledger, "planning", advisoryPlans, budgetStatus);
  if (budgetStatus.status === "blocked") {
    input.ledger.append({
      type: "evidence_update",
      phase: "review",
      role: "reviewer",
      evidence: [`pre-judge model debate blocked by budget: ${budgetStatus.reason}`]
    });
    return;
  }
  const notes = await runLiveAdvisoryForRoles(advisoryInput, roles);
  input.state.modelNotes.push(...notes);
  refreshUsageSummary(input.state);
  recordModelNoteEvents(input.ledger, notes, input.state.usageSummary);
  const startRound = Math.max(1, ...input.state.debateRounds.map((round) => round.round + 1));
  const modelRounds = buildModelDebateRounds(notes, input.state.candidates, startRound);
  input.state.debateRounds.push(...modelRounds);
  input.ledger.append({
    type: "evidence_update",
    phase: "review",
    role: "reviewer",
    evidence: [`pre-judge model debate rounds=${modelRounds.length}`]
  });
}

function recordTaskGraphEvent(state: AgentGraphState, ledger: EventLedger): void {
  const graph = state.plan?.taskGraph;
  if (!graph) return;
  ledger.append({
    type: "task_graph",
    phase: "planning",
    role: "planner",
    graphRef: ledger.writeArtifact("task_graphs", JSON.stringify(graph, null, 2), "json"),
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    entryNodeIds: graph.entryNodeIds,
    terminalNodeIds: graph.terminalNodeIds
  });
}

function recordEvidenceGaps(ledger: EventLedger, gaps: EvidenceDependencyGap[]): void {
  if (!gaps.length) return;
  const byRole = new Map<AgentRole, EvidenceDependencyGap[]>();
  for (const gap of gaps) byRole.set(gap.role, [...(byRole.get(gap.role) ?? []), gap]);
  for (const [role, roleGaps] of byRole.entries()) {
    ledger.append({
      type: "evidence_gap",
      phase: phaseForRole(role),
      role,
      missing: roleGaps.map((gap) => gap.missing),
      blocking: roleGaps.some((gap) => gap.blocking),
      reason: roleGaps.map((gap) => gap.reason).join(" ")
    });
  }
}

function recordDebateSessionEvents(state: AgentGraphState, ledger: EventLedger): void {
  const session = state.debateSession;
  if (!session) return;
  for (const move of session.moves.slice(0, 24)) {
    ledger.append({
      type: "debate_move",
      phase: move.moveType === "resolution" ? "judge" : "review",
      role: move.speaker === "judge" ? "judge" : "reviewer",
      debateSessionId: session.sessionId,
      moveId: move.id,
      round: move.round,
      speaker: String(move.speaker),
      moveType: move.moveType,
      targetCandidateId: move.targetCandidateId,
      summary: move.content,
      evidenceRefs: move.evidenceRefs,
      riskSignal: move.riskSignal
    });
  }
  ledger.append({
    type: "debate_resolution",
    phase: "judge",
    role: "judge",
    debateSessionId: session.sessionId,
    resolution: session.resolution,
    acceptedClaims: session.acceptedClaims,
    rejectedClaims: session.rejectedClaims,
    unresolvedBlockingIssues: session.unresolvedBlockingIssues,
    evidenceCoverageScore: session.evidenceCoverageScore,
    sessionRef: ledger.writeArtifact("debate_sessions", JSON.stringify(session, null, 2), "json")
  });
}

function recordRoleNodeExecutionResult(
  state: AgentGraphState,
  ledger: EventLedger,
  role: AgentRole,
  status: "success" | "failed" | "blocked" | "skipped",
  summary: string,
  artifacts: string[] = [],
  error?: string
): void {
  if (!state.roleGraphExecution) return;
  const execution = markRoleNodeResult(state.roleGraphExecution, {
    role,
    status,
    summary,
    artifacts,
    evidence: summary ? [summary] : [],
    error
  });
  if (!execution) return;
  ledger.append({
    type: "role_node_result",
    phase: phaseForRole(role),
    role,
    nodeId: execution.nodeId,
    status,
    summary,
    artifacts: execution.artifacts,
    evidence: execution.evidence,
    error
  });
}

type RunAgentStateOptions<T> = {
  agentKind?: AgentRunState["agentKind"];
  config?: TomorrowEdgeConfig;
  budgetFallback?: () => Promise<T>;
  budgetFallbackLabel?: string;
  budgetEstimateUsd?: number;
  escalationSignals?: string[];
};

async function runAgentState<T>(
  state: AgentGraphState,
  ledger: EventLedger,
  router: ModelRouter,
  role: AgentRole,
  fn: () => Promise<T>,
  optionsOrAgentKind?: AgentRunState["agentKind"] | RunAgentStateOptions<T>
): Promise<T> {
  const options: RunAgentStateOptions<T> = typeof optionsOrAgentKind === "string" ? { agentKind: optionsOrAgentKind } : optionsOrAgentKind ?? {};
  const rawAssignment = router.assignmentFor(role);
  const assignment = rawAssignment.provider.startsWith("external:") && options.agentKind === "offline"
    ? {
        role,
        provider: "local_tool",
        model: `native_${role}`,
        reason: `External route ${rawAssignment.provider}/${rawAssignment.model} is unavailable or not allowed for ${role}; using native ${role}. ${rawAssignment.reason}`
      }
    : rawAssignment;
  const effectiveAgentKind = options.agentKind ?? determineAgentKind(assignment.provider);
  if (!contractRoleAllowed(state.objectiveContract, role)) {
    const reason = `Objective contract does not allow role ${role}.`;
    recordContractToolBlockedAgent(state, ledger, role, phaseForRole(role), reason);
    throw new Error(reason);
  }
  const gate = options.config && shouldGateInvocation(effectiveAgentKind)
    ? evaluateRoleInvocation({
      config: options.config,
      runtime: state.budgetRuntime,
      role,
      phase: phaseForRole(role),
      assignment,
      roleBudget: roleBudgetFor(options.config, role),
      estimatedCostUsd: policyBudgetEstimate(options.budgetEstimateUsd ?? estimateCostUsd(assignment.provider, { inputTokens: 1000, outputTokens: 1000 }), state.orchestrationPolicy, role),
      escalationSignals: policyEscalationSignals(state.orchestrationPolicy, state.plan?.riskLevel, options.escalationSignals ?? inferStrongAgentEscalationSignals(state.goal)),
      canFallback: Boolean(options.budgetFallback) || canFallbackWhenBudgetBlocked(role)
    })
    : undefined;
  if (gate) {
    ledger.append({
      type: "budget_decision",
      phase: gate.phase,
      role,
      provider: assignment.provider,
      model: assignment.model,
      status: gate.action === "allow" ? "allowed" : "blocked",
      reason: gate.reason,
      budgetScope: gate.scope,
      maxCostUsd: roleBudgetFor(options.config!, role)?.maxCostPerCallUsd ?? options.config!.strong_agents.max_cost_usd,
      estimatedCostUsd: gate.estimatedCostUsd,
      strongAgentCallsUsed: state.budgetRuntime.strongAgentCallsUsed,
      strongAgentCallsRemaining: gate.remainingCalls
    });
    if (gate.action !== "allow") {
      state.budgetRuntime.blockedRoles[role] = gate.reason;
      recordBlockedAgentRun(state, ledger, role, assignment, effectiveAgentKind, gate);
      if (options.budgetFallback) {
        ledger.append({
          type: "fallback_to_native",
          phase: phaseForRole(role),
          role,
          provider: assignment.provider,
          model: assignment.model,
          fallbackRole: role,
          reason: `${gate.reason} Falling back to ${options.budgetFallbackLabel ?? `native ${role}`}.`
        });
        return runFallbackAgentState(state, ledger, role, gate.fallbackAssignment ?? {
          role,
          provider: "local_tool",
          model: `native_${role}`,
          reason: "native fallback"
        }, options.budgetFallback);
      }
      throw new Error(`Budget blocked ${role}: ${gate.reason}`);
    }
  }
  const agentState: AgentRunState = {
    id: role,
    role,
    provider: assignment.provider,
    model: assignment.model,
    status: "running",
    agentKind: effectiveAgentKind,
    startedAt: nowIso(),
    summary: assignment.reason
  };
  state.agents.push(agentState);
  const start = Date.now();
  const reservation = gate ? reserveRoleCall(state.budgetRuntime, gate) : undefined;
  try {
    const result = await fn();
    if (reservation) commitRoleCall(state.budgetRuntime, reservation);
    agentState.status = "success";
    agentState.summary = `${role} completed`;
    updateCapabilityStep(state, role, "success", agentState.summary);
    recordRoleNodeExecutionResult(state, ledger, role, "success", agentState.summary);
    if (assignment.provider !== "local_tool") {
      ledger.append({
        type: "agent_run",
        phase: phaseForRole(role),
        role,
        provider: assignment.provider,
        model: assignment.model,
        agentKind: effectiveAgentKind,
        status: "success",
        runId: agentState.id,
        responseRef: ledger.writeArtifact("responses", JSON.stringify(result, null, 2), "json")
      });
    }
    return result;
  } catch (error) {
    if (reservation) releaseRoleCall(state.budgetRuntime, reservation, error instanceof Error ? error.message : String(error));
    agentState.status = "failed";
    agentState.summary = error instanceof Error ? error.message : String(error);
    updateCapabilityStep(state, role, "blocked", agentState.summary);
    recordRoleNodeExecutionResult(state, ledger, role, "failed", agentState.summary, [], agentState.summary);
    if (assignment.provider !== "local_tool") {
      ledger.append({
        type: "agent_run",
        phase: phaseForRole(role),
        role,
        provider: assignment.provider,
        model: assignment.model,
        agentKind: effectiveAgentKind,
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

function shouldGateInvocation(agentKind: AgentRunState["agentKind"]): boolean {
  return agentKind === "live" || agentKind === "external";
}

function refreshUsageSummary(state: AgentGraphState): ModelUsageSummary {
  state.usageSummary = summarizeGraphModelUsage(state);
  return state.usageSummary;
}

function summarizeGraphModelUsage(state: AgentGraphState): ModelUsageSummary {
  const usage = summarizeModelUsage(state.modelNotes);
  let inputTokens = usage.inputTokens;
  let outputTokens = usage.outputTokens;
  let estimatedCostUsd = usage.estimatedCostUsd ?? 0;
  let hasCost = usage.estimatedCostUsd !== undefined;
  const noteSignatures = new Map<string, number>();
  for (const note of state.modelNotes) {
    if (!note.usage) continue;
    const signature = modelUsageSignature(note.role, note.provider, note.model, note.usage.inputTokens, note.usage.outputTokens);
    noteSignatures.set(signature, (noteSignatures.get(signature) ?? 0) + 1);
  }
  for (const event of state.events) {
    if (event.type !== "model_call" || event.status !== "success") continue;
    const eventInputTokens = event.inputTokens ?? 0;
    const eventOutputTokens = event.outputTokens ?? 0;
    const signature = event.role
      ? modelUsageSignature(event.role, event.provider ?? "", event.model ?? "", eventInputTokens, eventOutputTokens)
      : undefined;
    const duplicateNoteCount = signature ? noteSignatures.get(signature) ?? 0 : 0;
    if (duplicateNoteCount > 0) {
      noteSignatures.set(signature!, duplicateNoteCount - 1);
      continue;
    }
    inputTokens += eventInputTokens;
    outputTokens += eventOutputTokens;
    const eventCost = event.estimatedCostUsd ?? estimateCostUsd(event.provider ?? "", {
      inputTokens: eventInputTokens,
      outputTokens: eventOutputTokens
    });
    if (eventCost !== undefined) {
      estimatedCostUsd += eventCost;
      hasCost = true;
    }
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: hasCost ? Math.round(estimatedCostUsd * 1_000_000) / 1_000_000 : undefined
  };
}

function modelUsageSignature(role: AgentRole, provider: string, model: string, inputTokens: number, outputTokens: number): string {
  return `${role}|${provider}|${model}|${inputTokens}|${outputTokens}`;
}

function recordAccessBlockedExternalAgent(state: AgentGraphState, ledger: EventLedger, role: AgentRole, assignment: RouteAssignment, reason: string): void {
  const agentState: AgentRunState = {
    id: `${role}_access_blocked_${state.agents.filter((agent) => agent.role === role).length + 1}`,
    role,
    provider: assignment.provider,
    model: assignment.model,
    status: "blocked",
    agentKind: "external",
    startedAt: nowIso(),
    endedAt: nowIso(),
    elapsedMs: 0,
    summary: reason
  };
  if (state.roleGraphExecution) markRoleNodeRunning(state.roleGraphExecution, role);
  state.agents.push(agentState);
  updateCapabilityStep(state, role, "blocked", reason);
  ledger.append({
    type: "agent_run",
    phase: phaseForRole(role),
    role,
    provider: assignment.provider,
    model: assignment.model,
    agentKind: "external",
    status: "blocked",
    runId: agentState.id,
    error: reason
  });
  ledger.append({
    type: "autonomy_limit_reached",
    phase: phaseForRole(role),
    role,
    status: "blocked_by_access_mode",
    reason
  });
}

function recordBlockedAgentRun(state: AgentGraphState, ledger: EventLedger, role: AgentRole, assignment: RouteAssignment, agentKind: AgentRunState["agentKind"], gate: BudgetGateDecision): void {
  const agentState: AgentRunState = {
    id: `${role}_blocked_${state.agents.filter((agent) => agent.role === role).length + 1}`,
    role,
    provider: assignment.provider,
    model: assignment.model,
    status: "blocked",
    agentKind,
    startedAt: nowIso(),
    endedAt: nowIso(),
    elapsedMs: 0,
    summary: gate.reason
  };
  state.agents.push(agentState);
  updateCapabilityStep(state, role, "blocked", gate.reason);
  recordRoleNodeExecutionResult(state, ledger, role, "blocked", gate.reason, [], gate.reason);
  ledger.append({
    type: "agent_run",
    phase: phaseForRole(role),
    role,
    provider: assignment.provider,
    model: assignment.model,
    agentKind,
    status: "blocked",
    runId: agentState.id,
    error: gate.reason
  });
}

async function runFallbackAgentState<T>(state: AgentGraphState, ledger: EventLedger, role: AgentRole, assignment: RouteAssignment, fn: () => Promise<T>): Promise<T> {
  const agentState: AgentRunState = {
    id: `${role}_fallback_${state.agents.filter((agent) => agent.role === role).length + 1}`,
    role,
    provider: assignment.provider,
    model: assignment.model,
    status: "running",
    agentKind: "offline",
    startedAt: nowIso(),
    summary: assignment.reason
  };
  if (state.roleGraphExecution) markRoleNodeRunning(state.roleGraphExecution, role);
  state.agents.push(agentState);
  const start = Date.now();
  try {
    const result = await fn();
    agentState.status = "success";
    agentState.summary = `${role} fallback completed`;
    updateCapabilityStep(state, role, "success", agentState.summary);
    recordRoleNodeExecutionResult(state, ledger, role, "success", agentState.summary);
    ledger.append({
      type: "agent_run",
      phase: phaseForRole(role),
      role,
      provider: assignment.provider,
      model: assignment.model,
      agentKind: "offline",
      status: "success",
      runId: agentState.id,
      responseRef: ledger.writeArtifact("responses", JSON.stringify(result, null, 2), "json")
    });
    return result;
  } catch (error) {
    agentState.status = "failed";
    agentState.summary = error instanceof Error ? error.message : String(error);
    recordRoleNodeExecutionResult(state, ledger, role, "failed", agentState.summary, [], agentState.summary);
    ledger.append({
      type: "agent_run",
      phase: phaseForRole(role),
      role,
      provider: assignment.provider,
      model: assignment.model,
      agentKind: "offline",
      status: "failure",
      runId: agentState.id,
      error: agentState.summary
    });
    throw error;
  } finally {
    agentState.endedAt = nowIso();
    agentState.elapsedMs = Date.now() - start;
  }
}

function determineAgentKind(provider: string): AgentRunState["agentKind"] {
  if (provider.startsWith("external:")) return "external";
  if (["mock", "fixture", "local_tool"].includes(provider)) return "offline";
  return "live";
}

function updateCapabilityStep(state: AgentGraphState, role: AgentRole, status: "success" | "blocked", summary: string): void {
  if (!state.capabilityRoute) return;
  state.capabilityRoute = {
    ...state.capabilityRoute,
    steps: state.capabilityRoute.steps.map((step) => (step.role === role ? { ...step, status, summary } : step))
  };
}

async function maybeBuildRepairMemoryContext(runtime: OfflineGraphRuntime, state: AgentGraphState, failedRun: RunResult): Promise<RepairMemoryContext | undefined> {
  const { config, cwd, ledger } = runtime;
  const plan = state.plan;
  if (!plan || !failureMemoryEnabled(config, "repair_context")) return undefined;
  const query = buildRepairMemoryQuery(plan, failedRun, state.changedFiles);
  const policyResult = applyMemoryRetrievalPolicy(
    await explainFailureMemories(cwd, query, { limit: config.strategy_memory.max_records }),
    config.strategy_memory.policy,
    runtime.ledger.sessionId
  );
  recordMemoryPolicyDecision(ledger, "repair_context", "repairer", policyResult.decision);
  const explanation = policyResult.explanation;
  const context = buildRepairMemoryContext(query, explanation);
  state.failureMemory = state.failureMemory ?? emptyFailureMemoryInfluence();
  state.failureMemory.repairContext = context;
  recordMemoryRetrieval(state, ledger, "repair_context", "repairer", context, `repair context selected ${context.selectedMemoryIds.length} memories`);
  return context;
}

function recordMemoryPolicyDecision(ledger: EventLedger, stage: "premortem" | "repair_context", role: AgentRole, decision: MemoryRetrievalPolicyDecision): void {
  ledger.append({
    type: "memory_policy",
    phase: "memory",
    role,
    retrievalStage: stage,
    policyMode: decision.mode,
    action: decision.action,
    selectedBefore: decision.selectedBefore,
    selectedAfter: decision.selectedAfter,
    bypassedMemoryIds: decision.bypassedMemoryIds,
    reason: decision.reason
  });
}

function recordMemoryRetrieval(
  state: AgentGraphState,
  ledger: EventLedger,
  stage: "premortem" | "coder_constraints" | "review_guard" | "repair_context",
  role: AgentRole,
  payload: FailureMemoryPremortem | RepairMemoryContext | { selectedMemoryIds: string[]; rejected: unknown[]; constraints: unknown[] } | { selectedMemoryIds: string[]; rejected?: unknown[]; constraints: CandidateMemoryAssessment[] },
  summary: string
): void {
  const selectedMemoryIds = "selectedMemoryIds" in payload ? payload.selectedMemoryIds : [];
  const rejected = "rejected" in payload && Array.isArray(payload.rejected) ? payload.rejected : [];
  const constraints = "constraints" in payload && Array.isArray(payload.constraints) ? payload.constraints : [];
  const artifactRef = ledger.writeArtifact("memory", JSON.stringify(payload, null, 2), "json");
  ledger.append({
    type: "memory_retrieval",
    phase: memoryRetrievalPhase(stage),
    role,
    retrievalStage: stage,
    selectedMemoryIds,
    rejectedCount: rejected.length,
    constraintCount: constraints.length,
    artifactRef,
    summary
  });
}

function memoryRetrievalPhase(stage: "premortem" | "coder_constraints" | "review_guard" | "repair_context"): EventPhase {
  if (stage === "premortem") return "planning";
  if (stage === "coder_constraints") return "coding";
  if (stage === "review_guard") return "review";
  return "repair";
}

function failureMemoryEnabled(config: TomorrowEdgeConfig, feature: "failure_premortem" | "coder_constraints" | "review_guard" | "repair_context"): boolean {
  return Boolean(config.strategy_memory.enabled && config.strategy_memory[feature]);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()).map((value) => value.trim()))];
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

function recordShellRunEvent(state: AgentGraphState, ledger: EventLedger, cwd: string, result: RunResult): ShellRunEvent {
  const stdoutRef = ledger.writeArtifact("stdout", result.stdout);
  const stderrRef = ledger.writeArtifact("stderr", result.stderr);
  recordArtifactProjection(state, ledger, "shell", stdoutRef, result.stdout, "stdout", "runner");
  recordArtifactProjection(state, ledger, "shell", stderrRef, result.stderr, "stderr", "runner");
  recordEvidencePacket(state, ledger, buildTestEvidence(result, { stdoutRef, stderrRef }), "runner");
  return ledger.append({
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
    success: result.success,
    skipped: result.skipped,
    skipReason: result.skipReason
  }) as ShellRunEvent;
}

function normalizeVerificationResult(result: RunResult, options: { defaultVerification: boolean }): RunResult {
  if (options.defaultVerification && isMissingNpmTestScript(result)) {
    return {
      ...result,
      success: true,
      skipped: true,
      skipReason: "package.json has no npm test script; default verification skipped"
    };
  }
  return result;
}

function isMissingNpmTestScript(result: RunResult): boolean {
  if (result.success || result.command.trim() !== "npm test") return false;
  return /Missing script:\s*"?test"?/i.test(`${result.stdout}\n${result.stderr}`);
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

function recordPatchApplicationPrediction(ledger: EventLedger, candidate: PatchCandidate, target: Extract<OutcomeTarget, "patch" | "repair">, willApply: boolean, note?: string): OutcomePredictionEvent {
  const expectedBehavior = [
    target === "repair" ? `Repair ${candidate.candidateId}` : `Apply ${candidate.candidateId}`,
    candidate.summary,
    candidate.filesChanged.length ? `expected files: ${candidate.filesChanged.join(", ")}` : "no expected files recorded",
    note
  ].filter(Boolean).join("; ");
  return recordOutcomePrediction(ledger, {
    phase: target === "repair" ? "repair" : "patch",
    role: target === "repair" ? "repairer" : "runner",
    target,
    candidateId: candidate.candidateId,
    expectedChangedFiles: candidate.filesChanged,
    predictedOutcome: willApply ? "applied" : "blocked",
    expectedBehavior,
    expectedTestOutcome: candidate.testPlan.join("; ") || "verification should confirm the patch behavior",
    uncertainty: candidate.estimatedRisk === "high" ? "high" : candidate.estimatedRisk === "medium" ? "medium" : "low"
  });
}

function recordShellPrediction(ledger: EventLedger, command: string, expectedBehavior: string): OutcomePredictionEvent {
  return recordOutcomePrediction(ledger, {
    phase: "shell",
    role: "runner",
    target: "shell",
    command,
    predictedOutcome: "passed",
    expectedBehavior,
    expectedTestOutcome: `${command} should pass or be explicitly skipped by verifier policy.`,
    uncertainty: "medium"
  });
}

function recordOutcomePrediction(
  ledger: EventLedger,
  input: {
    phase: EventPhase;
    role: AgentRole;
    target: OutcomeTarget;
    candidateId?: string;
    command?: string;
    expectedChangedFiles?: string[];
    predictedOutcome: PredictedOutcome;
    expectedBehavior: string;
    expectedTestOutcome?: string;
    uncertainty: "low" | "medium" | "high";
  }
): OutcomePredictionEvent {
  const predictionRef = ledger.writeArtifact("predictions", JSON.stringify({
    target: input.target,
    candidateId: input.candidateId,
    command: input.command,
    predictedOutcome: input.predictedOutcome,
    expectedBehavior: input.expectedBehavior,
    expectedTestOutcome: input.expectedTestOutcome,
    uncertainty: input.uncertainty
  }, null, 2), "json");
  return ledger.append({
    type: "outcome_prediction",
    phase: input.phase,
    role: input.role,
    target: input.target,
    candidateId: input.candidateId,
    command: input.command,
    expectedChangedFiles: input.expectedChangedFiles,
    predictedOutcome: input.predictedOutcome,
    expectedBehavior: input.expectedBehavior,
    expectedTestOutcome: input.expectedTestOutcome,
    uncertainty: input.uncertainty,
    predictionRef
  }) as OutcomePredictionEvent;
}

function recordOutcomeObservation(
  ledger: EventLedger,
  prediction: OutcomePredictionEvent,
  observedOutcome: ObservedOutcome,
  summary: string,
  run?: RunResult
): void {
  const mismatchType = classifyOutcomeMismatch(prediction, observedOutcome, run);
  const observationRef = ledger.writeArtifact("observations", JSON.stringify({
    predictionEventId: prediction.id,
    target: prediction.target,
    candidateId: prediction.candidateId,
    command: prediction.command,
    predictedOutcome: prediction.predictedOutcome,
    observedOutcome,
    matched: mismatchType === "matched",
    mismatchType,
    summary
  }, null, 2), "json");
  ledger.append({
    type: "outcome_observation",
    phase: prediction.phase,
    role: prediction.role,
    target: prediction.target,
    predictionEventId: prediction.id,
    candidateId: prediction.candidateId,
    command: prediction.command,
    predictedOutcome: prediction.predictedOutcome,
    observedOutcome,
    matched: mismatchType === "matched",
    mismatchType,
    summary,
    observationRef
  });
}

function observedShellOutcome(result: RunResult): ObservedOutcome {
  if (result.skipped) return "skipped";
  return result.success ? "passed" : "failed";
}

function classifyOutcomeMismatch(prediction: OutcomePredictionEvent, observedOutcome: ObservedOutcome, run?: RunResult): OutcomeMismatchType {
  if (prediction.predictedOutcome === observedOutcome) return "matched";
  if (observedOutcome === "blocked") return "unsafe_action_blocked";
  const text = `${run?.command ?? ""}\n${run?.stdout ?? ""}\n${run?.stderr ?? ""}`.toLowerCase();
  if (/not recognized|command not found|enoent|permission denied|access is denied|spawn .* enoent/.test(text)) return "environment_issue";
  if (/cannot find module|module not found|no such file|file not found|missing dependency/.test(text)) return "incomplete_context";
  if (/flaky|flake|intermittent|timeout|timed out|random/i.test(text)) return "flaky_result";
  if (prediction.target === "shell" && observedOutcome === "skipped") return "wrong_validator";
  return "wrong_assumption";
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

function recordRoutingAndBudgetPreview(config: TomorrowEdgeConfig, state: AgentGraphState, ledger: EventLedger, assignment: RouteAssignment, goal: string, phase: "routing" | "planning"): void {
  const decision = buildRoleRoutingDecision(config, assignment);
  const policy = state.orchestrationPolicy;
  const roleBudget = roleBudgetFor(config, assignment.role);
  const estimatedCostUsd = policyBudgetEstimate(
    estimateCostUsd(assignment.provider, { inputTokens: 1000, outputTokens: 1000 }),
    policy,
    assignment.role
  );
  const budgetDecision = allocateStrongAgentCall(assignment.role, state.budgetRuntime.strongAgentCallsUsed, {
    maxCallsPerTask: config.strong_agents.max_calls_per_task,
    maxCostUsd: config.strong_agents.max_cost_usd,
    reserveForRoles: config.strong_agents.reserve_for_roles,
    escalateOn: config.strong_agents.escalate_on
  }, {
    estimatedCostUsd,
    escalationSignals: policyEscalationSignals(policy, state.plan?.riskLevel, inferStrongAgentEscalationSignals(goal)),
    roleBudget,
    roleUsedCalls: state.budgetRuntime.roleCallsUsed[assignment.role] ?? 0
  });
  ledger.append({
    type: "routing_decision",
    phase,
    role: assignment.role,
    provider: assignment.provider,
    model: assignment.model,
    assignedRole: decision.role,
    assignedProvider: decision.provider,
    assignedModel: decision.model,
    reason: `${decision.reason}; ${policyRouteTag(policy)}`,
    policyTags: [...decision.policyTags, policyRouteTag(policy)]
  });
  ledger.append({
    type: "budget_preview",
    phase,
    role: assignment.role,
    provider: assignment.provider,
    model: assignment.model,
    status: budgetDecision.allowed ? "allowed" : "blocked",
    reason: budgetDecision.reason,
    budgetScope: budgetDecision.scope,
    maxCostUsd: roleBudget?.maxCostPerCallUsd ?? config.strong_agents.max_cost_usd,
    estimatedCostUsd: budgetDecision.estimatedCostUsd,
    strongAgentCallsUsed: state.budgetRuntime.strongAgentCallsUsed,
    strongAgentCallsRemaining: budgetDecision.remainingCalls
  });
}

function roleBudgetFor(config: TomorrowEdgeConfig, role: AgentRole): NonNullable<Parameters<typeof allocateStrongAgentCall>[3]>["roleBudget"] {
  const budget = config.agents[role]?.budget;
  if (!budget) return undefined;
  if (budget.max_calls_per_task === undefined && budget.max_cost_per_call_usd === undefined) return undefined;
  return {
    maxCallsPerTask: budget.max_calls_per_task,
    maxCostPerCallUsd: budget.max_cost_per_call_usd
  };
}

function routingForState(router: ModelRouter, hasImageInputs: boolean): AgentGraphState["routing"] {
  const plan = router.getPlan();
  if (hasImageInputs) return plan;
  return {
    ...plan,
    assignments: plan.assignments.filter((assignment) => assignment.role !== "vision"),
    fallbacks: plan.fallbacks.filter((assignment) => assignment.role !== "vision")
  };
}

function contractAllowsPatchMutation(state: AgentGraphState, ledger: EventLedger, phase: "patch" | "repair"): boolean {
  const patchGate = contractToolGate(state.objectiveContract, "patch_apply");
  const writeGate = contractToolGate(state.objectiveContract, "file_write");
  const phaseAllowed = contractPhaseAllowed(state.objectiveContract, phase);
  const roleAllowed = contractRoleAllowed(state.objectiveContract, "runner");
  const reason = !patchGate.allowed
    ? patchGate.reason
    : !writeGate.allowed
      ? writeGate.reason
      : !phaseAllowed
        ? `Objective contract does not allow phase ${phase}.`
        : !roleAllowed
          ? "Objective contract does not allow runner role."
          : "";
  if (!reason) return true;
  ledger.append({ type: "workflow_stop_reason", phase, role: "runner", reason, result: "aborted" });
  recordContractToolBlockedAgent(state, ledger, "runner", phase, reason);
  return false;
}

function contractAllowsShell(state: AgentGraphState, ledger: EventLedger): boolean {
  const shellGate = contractToolGate(state.objectiveContract, "shell");
  const phaseAllowed = contractPhaseAllowed(state.objectiveContract, "shell");
  const roleAllowed = contractRoleAllowed(state.objectiveContract, "runner");
  const reason = !shellGate.allowed
    ? shellGate.reason
    : !phaseAllowed
      ? "Objective contract does not allow shell phase."
      : !roleAllowed
        ? "Objective contract does not allow runner role."
        : "";
  if (!reason) return true;
  ledger.append({ type: "workflow_stop_reason", phase: "shell", role: "runner", reason, result: "aborted" });
  recordContractToolBlockedAgent(state, ledger, "runner", "shell", reason);
  return false;
}

function recordContractToolBlockedAgent(state: AgentGraphState, ledger: EventLedger, role: AgentRole, phase: EventPhase, reason: string): void {
  state.agents.push({
    id: `${role}_contract_gate_${state.agents.filter((agent) => agent.role === role).length + 1}`,
    role,
    provider: "local_tool",
    model: "contract_gate",
    status: "blocked",
    agentKind: "offline",
    startedAt: nowIso(),
    endedAt: nowIso(),
    elapsedMs: 0,
    summary: reason
  });
  ledger.append({
    type: "agent_run",
    phase,
    role,
    provider: "local_tool",
    model: "contract_gate",
    agentKind: "offline",
    status: "blocked",
    runId: `${role}_contract_gate`,
    error: reason
  });
}

function canRunShell(config: TomorrowEdgeConfig, state: AgentGraphState, shellRuns: number, ledger: EventLedger): boolean {
  const maxShellRuns = effectiveMaxShellRuns(config, state.objectiveContract);
  if (shellRuns < maxShellRuns) return true;
  ledger.append({ type: "autonomy_limit_reached", phase: "shell", status: "blocked_by_iteration_limit", reason: `max_shell_runs=${maxShellRuns} reached` });
  return false;
}

function canAttemptRepair(config: TomorrowEdgeConfig, state: AgentGraphState, repairs: number, ledger: EventLedger): boolean {
  const maxRepairs = effectiveMaxRepairRounds(config, state.objectiveContract, state.orchestrationPolicy);
  if (repairs < maxRepairs) return true;
  ledger.append({ type: "autonomy_limit_reached", phase: "repair", status: "blocked_by_iteration_limit", reason: `max_repairs=${maxRepairs} reached` });
  return false;
}

function recordRepairPolicyDecision(state: AgentGraphState, ledger: EventLedger, failedRun: RunResult, occurrences: Map<string, number>): RepairPolicyDecision {
  const firstPass = decideRepairPolicy({ failedRun, changedFiles: state.changedFiles });
  const previousOccurrences = occurrences.get(firstPass.failureSignature) ?? 0;
  const decision = previousOccurrences
    ? decideRepairPolicy({ failedRun, changedFiles: state.changedFiles, previousOccurrences })
    : firstPass;
  const policyDecision = shouldStopOnRecurringFailure(state.orchestrationPolicy) && decision.occurrence > 1
    ? { ...decision, action: "stop" as const, strategy: "policy stop on recurring failure", reason: `${decision.reason} Orchestration policy stopOnRecurringFailure=true.` }
    : decision;
  occurrences.set(policyDecision.failureSignature, policyDecision.occurrence);
  ledger.append({
    type: "repair_policy",
    phase: "repair",
    role: "repairer",
    failureClass: policyDecision.failureClass,
    failureSignature: policyDecision.failureSignature,
    occurrence: policyDecision.occurrence,
    action: policyDecision.action,
    strategy: policyDecision.strategy,
    reason: policyDecision.reason
  });
  if (policyDecision.action === "escalate" || policyDecision.action === "stop") {
    ledger.append({
      type: "autonomy_limit_reached",
      phase: "repair",
      status: "blocked_by_iteration_limit",
      reason: policyDecision.reason
    });
  }
  return policyDecision;
}

function allowsPatchRepair(decision: RepairPolicyDecision): boolean {
  return decision.action === "repair";
}

function setBudgetStatus(state: AgentGraphState, status: NonNullable<AgentGraphState["budgetStatus"]>): NonNullable<AgentGraphState["budgetStatus"]> {
  state.budgetStatus = status;
  state.budgetStatuses.push(status);
  return status;
}

function recordLiveBudgetDecisions(
  ledger: EventLedger,
  phase: "planning" | "coding",
  plans: Array<{ role: AgentRole; provider: string; model: string }>,
  status: ModelBudgetStatus
): void {
  for (const plan of plans) {
    ledger.append({
      type: "budget_decision",
      phase,
      role: plan.role,
      provider: plan.provider,
      model: plan.model,
      status: status.status === "blocked" ? "blocked" : status.status === "price_unknown" ? "warn" : "allowed",
      reason: status.reason,
      budgetScope: "efficient",
      maxCostUsd: status.maxCostUsd,
      estimatedCostUsd: status.estimatedCostUsd
    });
  }
}

function canUseGovernanceModel(runtime: OfflineGraphRuntime, state: AgentGraphState, role: AgentRole, prompt: string, maxOutputTokens: number, label: string): boolean {
  if (!runtime.access.cloudAllowed) {
    runtime.ledger.append({
      type: "autonomy_limit_reached",
      phase: phaseForRole(role),
      role,
      status: "blocked_by_access_mode",
      reason: `${label} blocked by access mode: ${runtime.access.mode}.`
    });
    return false;
  }
  const assignment = runtime.router.assignmentFor(role);
  const budgetStatus = preflightBudget(
    [{ provider: assignment.provider, prompt, maxOutputTokens }],
    runtime.config.routing.max_cost_usd
  );
  if (state.budgetStatus?.status === "blocked") {
    state.budgetStatuses.push(budgetStatus);
  } else {
    setBudgetStatus(state, budgetStatus);
  }
  recordLiveBudgetDecisions(runtime.ledger, "planning", [assignment], budgetStatus);
  if (budgetStatus.status === "blocked") {
    runtime.ledger.append({
      type: "autonomy_limit_reached",
      phase: phaseForRole(role),
      role,
      status: "blocked_by_budget",
      reason: `${label} blocked before model invocation: ${budgetStatus.reason}`
    });
    return false;
  }
  const invocationKind = label.includes("debate") ? "pre_judge_debate" : label.includes("planner") ? "model_planner" : "live_advisory";
  const invocationGate = evaluateModelCallInvocation({
    config: runtime.config,
    runtime: state.budgetRuntime,
    invocation: invocationKind,
    role,
    assignment,
    roleBudget: roleBudgetFor(runtime.config, role),
    estimatedCostUsd: budgetStatus.estimatedCostUsd,
    escalationSignals: policyEscalationSignals(state.orchestrationPolicy, state.plan?.riskLevel, inferStrongAgentEscalationSignals(state.goal)),
    canFallback: false
  });
  runtime.ledger.append({
    type: "budget_decision",
    phase: invocationGate.phase,
    role,
    provider: assignment.provider,
    model: assignment.model,
    status: invocationGate.action === "allow" ? "allowed" : "blocked",
    reason: invocationGate.reason,
    invocationKind,
    budgetScope: invocationGate.scope,
    maxCostUsd: roleBudgetFor(runtime.config, role)?.maxCostPerCallUsd ?? runtime.config.strong_agents.max_cost_usd,
    estimatedCostUsd: invocationGate.estimatedCostUsd,
    strongAgentCallsUsed: state.budgetRuntime.strongAgentCallsUsed,
    strongAgentCallsRemaining: invocationGate.remainingCalls
  });
  if (invocationGate.action !== "allow") {
    runtime.ledger.append({
      type: "autonomy_limit_reached",
      phase: phaseForRole(role),
      role,
      status: "blocked_by_budget",
      reason: `${label} blocked by unified budget gate: ${invocationGate.reason}`
    });
    return false;
  }
  return true;
}

function canContinueAutonomy(config: TomorrowEdgeConfig, state: AgentGraphState, ledger: EventLedger, startedAtMs: number, phase: "shell" | "repair" | "summary" | "coding"): boolean {
  const elapsedSec = (Date.now() - startedAtMs) / 1000;
  if (elapsedSec > config.autonomy.max_wall_time_sec) {
    ledger.append({ type: "autonomy_limit_reached", phase, status: "blocked_by_time_limit", reason: `max_wall_time_sec=${config.autonomy.max_wall_time_sec} reached` });
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

function inferStrongAgentEscalationSignals(goal: string): string[] {
  const normalized = goal.toLowerCase();
  const signals: string[] = [];
  if (/\b(auth|secret|token|credential|password|permission|security|crypto|payment)\b/.test(normalized)) signals.push("security_sensitive_change");
  if (/\b(repair|failing again|still failing|repeated failure|flaky)\b/.test(normalized)) signals.push("repeated_test_failure");
  if (/\b(high risk|risky|dangerous|production|database|migration)\b/.test(normalized)) signals.push("high_risk_patch");
  if (/\b(disagree|disagreement|debate|tie-break|judge)\b/.test(normalized)) signals.push("reviewer_disagreement");
  return signals;
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
