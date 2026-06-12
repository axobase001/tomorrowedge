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
import { estimateCostUsd, estimateTextTokens, preflightBudget, summarizeModelUsage } from "../model/costAccounting.js";
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
import { buildEvidencePacket } from "../evidence/evidenceBuilder.js";
import type { EvidencePacket } from "../evidence/evidencePacket.js";
import { validateEvidenceDependencies, validateEvidenceForTaskNode, type EvidenceDependencyGap } from "../evidence/evidenceDependency.js";
import { computeTraceCompleteness } from "../diagnostics/traceCompleteness.js";
import { buildRoleRoutingDecision } from "../roleRouting/roleRoutingPolicy.js";
import { allocateStrongAgentCall } from "../budget/budgetAllocator.js";
import { canFallbackWhenBudgetBlocked, commitRoleCall, createBudgetRuntimeState, evaluateModelCallInvocation, evaluateRoleInvocation, releaseRoleCall, reserveRoleCall, type BudgetGateDecision, type BudgetReservation, type ModelInvocationKind } from "../budget/budgetGate.js";
import type { RouteAssignment } from "../routing/policies.js";
import type { EventPhase, ObservedOutcome, OutcomeMismatchType, OutcomePredictionEvent, OutcomeTarget, PredictedOutcome, ShellRunEvent, TomorrowEdgeEvent } from "../events/eventTypes.js";
import { buildRoleGraph, type RoleNode } from "../orchestration/roleGraph.js";
import { beginRoleNode, blockRoleNode, completeRoleNode, createRoleGraphExecutionState, markRoleNodeResult, markRoleNodeRunning, readyRoleNodes, shouldStopRoleGraph, skipRoleNode } from "../orchestration/roleGraphScheduler.js";
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
import { parseTaskGraphCandidate, validateTaskGraph } from "../planning/taskGraphValidator.js";
import { nextReadyTaskNodes, readyTaskNodeForRoleNode, readyTaskNodesForRoleNode, taskGraphAllowsRoleNode } from "../planning/taskGraphScheduler.js";
import type { TaskGraph, TaskGraphNode } from "../planning/taskGraph.js";
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

class WorkflowBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowBlockedError";
  }
}

export async function runOfflineGraph(cwd: string, goal: string, config: TomorrowEdgeConfig, options: OfflineGraphOptions = {}): Promise<AgentGraphState> {
  const runtime = createOfflineGraphRuntime(cwd, goal, config, options);
  const state = createInitialGraphState(runtime);

  try {
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
      recordAccessBlockedLiveRequests(runtime, state);
      await maybeRunGovernedReadOnlyAdvisory({ cwd, goal, config, router: runtime.router, ledger: runtime.ledger, state, access: runtime.access });
      return finalizeReadOnlyState(runtime, state);
    }

    await runScheduledPatchWorkflow(runtime, state);
    if (state.workflowBlockedReason) return finalizeBlockedByEvidenceGate(runtime, state, state.workflowBlockedReason);
    return finalizeState(runtime, state);
  } catch (error) {
    if (error instanceof WorkflowBlockedError) {
      state.workflowBlockedReason = error.message;
      return finalizeBlockedByEvidenceGate(runtime, state, error.message);
    }
    throw error;
  }
}

function recordAccessBlockedLiveRequests(runtime: OfflineGraphRuntime, state: AgentGraphState): void {
  const { access, config, ledger, options } = runtime;
  if (access.cloudAllowed) return;
  const blockedRequests: Array<{ phase: EventPhase; reason: string }> = [];
  if (options.livePatch) {
    blockedRequests.push({ phase: "coding", reason: `Live patch generation blocked by access mode: ${access.mode}.` });
  }
  if (options.liveAdvisory) {
    blockedRequests.push({ phase: "planning", reason: `Live advisory blocked by access mode: ${access.mode}.` });
  }
  for (const request of blockedRequests) {
    const budgetStatus = setBudgetStatus(state, {
      status: "blocked",
      maxCostUsd: config.routing.max_cost_usd,
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
      reason: request.reason
    });
    ledger.append({ type: "autonomy_limit_reached", phase: request.phase, status: "blocked_by_budget", reason: budgetStatus.reason });
  }
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
          payload: await new PlannerAgent().run({ goal: [targetPromptPrefix(conversationTarget), goal].filter(Boolean).join("\n\n") }),
          evidencePackets: []
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
  const plannerCacheContext = {
    accessMode: access.mode,
    workflowKind: workflowIntent.workflowKind,
    requiresPatchWorkflow: workflowIntent.requiresPatchWorkflow,
    allowedPhases: state.objectiveContract?.allowedPhases ?? [],
    allowedRoles: state.objectiveContract?.allowedRoles ?? [],
    allowedTools: state.objectiveContract?.allowedTools ?? []
  };
  const cachedPlan = !state.plan && !externalPlanner ? getCachedPlan(cwd, plannerGoal, plannerCacheContext) : undefined;
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
    recordExternalInvocationEvidence(state, ledger, result, "planner");
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
    const plannerBudgetScope = beginGovernanceModelInvocation(runtime, state, {
      invocation: "model_planner",
      label: "model-backed planner",
      prompt: plannerGoal,
      maxOutputTokens: 900,
      localOnly: options.fixtureMode || !access.cloudAllowed
    });
    let modelPlan = { provider: "local_planner_fallback", model: "native", fallbackUsed: true, error: "Model-backed planner blocked before invocation by budget or access policy." } as Awaited<ReturnType<typeof createModelBackedPlan>>;
    if (plannerBudgetScope) {
      try {
        modelPlan = await createModelBackedPlan({ goal, config, router, ledger, localOnly: options.fixtureMode || !access.cloudAllowed });
        if (modelPlan.plan) {
          commitModelInvocationBudgetScope(state, plannerBudgetScope);
        } else {
          releaseModelInvocationBudgetScope(state, plannerBudgetScope.reservations, modelPlan.error ?? "model-backed planner returned no valid plan");
        }
      } catch (error) {
        releaseModelInvocationBudgetScope(state, plannerBudgetScope.reservations, error instanceof Error ? error.message : String(error));
        throw error;
      }
    }
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
  const governanceBudgetScope = beginGovernanceModelInvocation(runtime, state, {
    invocation: "task_governance",
    label: "task governance",
    prompt: goal,
    maxOutputTokens: 360,
    localOnly: options.fixtureMode || options.provider === "fixture" || !access.cloudAllowed
  });
  state.taskGovernance = await classifyTaskGovernance({
    goal,
    plan: state.plan,
    workflowIntent,
    config,
    router,
    ledger,
    localOnly: options.fixtureMode || options.provider === "fixture" || !access.cloudAllowed,
    modelDisabled: !governanceBudgetScope
  });
  if (governanceBudgetScope) {
    if (state.taskGovernance.fallbackUsed) {
      releaseModelInvocationBudgetScope(state, governanceBudgetScope.reservations, state.taskGovernance.reason);
    } else {
      commitModelInvocationBudgetScope(state, governanceBudgetScope);
    }
  }
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
    rememberPlan(cwd, plannerGoal, state.plan, plannerCacheContext);
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
    debate: parallelRolesAllowed(state) && Boolean(plan.debateRecommended || config.debate.enabled) && config.debate.max_candidates > 1,
    allowParallelRoles: parallelRolesAllowed(state),
    allowedRoles: state.objectiveContract?.allowedRoles,
    allowedPhases: state.objectiveContract?.allowedPhases
  });
  state.roleGraphExecution = createRoleGraphExecutionState(state.roleGraph);
  const nativeTaskGraph = buildTaskGraph({
    plan: state.plan,
    contract: state.objectiveContract,
    roleGraph: state.roleGraph,
    policy
  });
  if (!state.plan.taskGraph || !taskGraphMatchesRoleGraph(state.plan.taskGraph, state.roleGraph)) {
    state.plan.taskGraph = nativeTaskGraph;
  }
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
  recordRoleNodeExecutionResult(state, ledger, "planner", "success", "planner produced contract-bound role graph and task graph");
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
  if (cachedContextSelection) {
    recordRoleNodeExecutionResult(state, ledger, "explorer", "success", "explorer context selection restored from cache");
  }
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

async function runScheduledPatchWorkflow(runtime: OfflineGraphRuntime, state: AgentGraphState): Promise<void> {
  if (!state.roleGraphExecution) {
    await runCandidatePhase(runtime, state);
    await runReviewAndJudgePhase(runtime, state);
    await runPostJudgeAdvisoryIfNeeded(runtime, state);
    await runPatchApplicationPhase(runtime, state);
    if (state.workflowBlockedReason) return;
    await runVerificationAndRepairPhase(runtime, state);
    return;
  }
  while (!state.workflowBlockedReason) {
    const ready = readyRoleNodes(state.roleGraphExecution);
    if (state.roleGraphExecution && shouldStopRoleGraph(state.roleGraphExecution) && state.roleGraphExecution.stopReason !== "role graph complete") {
      state.workflowBlockedReason = state.roleGraphExecution.stopReason;
      runtime.ledger.append({
        type: "workflow_stop_reason",
        phase: "planning",
        role: "planner",
        reason: state.roleGraphExecution.stopReason ?? "role graph stopped",
        result: "aborted"
      });
      return;
    }
    const execution = await executeReadyRoleGraphNodes(runtime, state);
    if (!execution.executed) {
      if (ready.length) {
        const taskReady = state.plan?.taskGraph ? nextReadyTaskNodes(state.plan.taskGraph).map((node) => node.id).join(", ") : "none";
        blockScheduledWorkflow(runtime, state, ready[0]!.role, `RoleGraphScheduler stopped: ready role nodes cannot run because TaskGraph has no matching ready action. readyRoles=${ready.map((node) => node.id).join(", ")} readyTasks=${taskReady}`);
      }
      return;
    }
    if (!state.workflowBlockedReason && execution.executedRoles.includes("coder_a") && state.candidates.length === 0 && !ready.some((node) => node.role === "coder_b")) {
      blockScheduledWorkflow(runtime, state, "coder_a", "RoleGraphScheduler stopped: coder_a produced no patch candidates.");
      return;
    }
    if (!state.workflowBlockedReason && execution.executedNodeIds.includes("judge")) {
      await runPostJudgeAdvisoryIfNeeded(runtime, state);
    }
    if (state.roleGraphExecution && shouldStopRoleGraph(state.roleGraphExecution) && state.roleGraphExecution.stopReason === "role graph complete") {
      return;
    }
    if (!ready.length) {
      break;
    }
  }
}

async function executeReadyRoleGraphNodes(runtime: OfflineGraphRuntime, state: AgentGraphState): Promise<{ executed: number; executedNodeIds: string[]; executedRoles: AgentRole[] }> {
  if (!state.roleGraphExecution) return { executed: 0, executedNodeIds: [], executedRoles: [] };
  const graph = state.plan?.taskGraph;
  const ready = readyRoleNodes(state.roleGraphExecution);
  const runnable = ready
    .map((node) => ({ node, taskNode: readyTaskNodeForRoleNode(graph, node) }))
    .filter((entry): entry is { node: RoleNode; taskNode: TaskGraphNode } => Boolean(entry.taskNode));
  if (!runnable.length) return { executed: 0, executedNodeIds: [], executedRoles: [] };

  const candidateEntries = runnable.filter((entry) => (entry.node.id === "coder_a" || entry.node.id === "coder_b") && entry.taskNode.kind === "patch");
  const livePatchPrimaryEntry = runtime.options.livePatch && runtime.access.cloudAllowed
    ? candidateEntries.find((entry) => entry.node.id === "coder_a")
    : undefined;
  const batch = livePatchPrimaryEntry
    ? [livePatchPrimaryEntry]
    : candidateEntries.length > 1 && parallelRolesAllowed(state)
    ? candidateEntries
    : [runnable[0]!];
  await Promise.all(batch.map((entry) => executeReadyTaskNode(runtime, state, entry.taskNode, entry.node)));
  return {
    executed: batch.length,
    executedNodeIds: batch.map((entry) => entry.node.id),
    executedRoles: batch.map((entry) => entry.node.role)
  };
}

async function executeReadyRoleGraphNode(runtime: OfflineGraphRuntime, state: AgentGraphState, node: RoleNode): Promise<void> {
  if (!state.roleGraphExecution) return;
  if (!readyRoleNodes(state.roleGraphExecution).some((ready) => ready.id === node.id)) {
    throw new WorkflowBlockedError(`RoleGraph refused to execute ${node.id}: node is not ready.`);
  }
  if (!taskGraphAllowsRoleNode(state.plan?.taskGraph, node)) {
    const taskReady = state.plan?.taskGraph ? nextReadyTaskNodes(state.plan.taskGraph).map((item) => item.id).join(", ") : "none";
    throw new WorkflowBlockedError(`TaskGraph refused to execute ${node.id}: no matching ready task node. readyTasks=${taskReady}`);
  }
  const readyTasks = readyTaskNodesForRoleNode(state.plan?.taskGraph, node).map((item) => item.id);
  if (readyTasks.length) {
    runtime.ledger.append({
      type: "evidence_update",
      phase: phaseForRole(node.role),
      role: node.role,
      evidence: [`RoleGraph node ${node.id} executing TaskGraph node(s): ${readyTasks.join(", ")}`]
    });
  }
  const taskNode = readyTaskNodeForRoleNode(state.plan?.taskGraph, node);
  if (!taskNode) throw new WorkflowBlockedError(`TaskGraph refused to execute ${node.id}: no ready task node was available.`);
  await executeReadyTaskNode(runtime, state, taskNode, node);
}

async function executeReadyTaskNode(runtime: OfflineGraphRuntime, state: AgentGraphState, taskNode: TaskGraphNode, roleNode: RoleNode): Promise<void> {
  if (!state.roleGraphExecution) return;
  runtime.ledger.append({
    type: "evidence_update",
    phase: taskNode.phase,
    role: taskNode.ownerRole,
    evidence: [`RoleGraph node ${roleNode.id} dispatches TaskGraph node ${taskNode.id} (${taskNode.kind})`]
  });
  markTaskNodesRunning(state, runtime.ledger, roleNode.id, roleNode.role, `${roleNode.id} executing ${taskNode.id}`);
  if (taskNode.kind === "patch") {
    if (roleNode.id !== "coder_a" && roleNode.id !== "coder_b") throw new WorkflowBlockedError(`TaskGraph patch node ${taskNode.id} cannot be executed by ${roleNode.id}.`);
    await runCoderRoleNode(runtime, state, roleNode.id);
    return;
  }
  if (taskNode.kind === "review") {
    await runReviewerRoleNode(runtime, state);
    return;
  }
  if (taskNode.kind === "judge") {
    await runJudgeRoleNode(runtime, state);
    return;
  }
  if (taskNode.kind === "apply_patch") {
    await runPatchApplicationPhase(runtime, state);
    return;
  }
  if (taskNode.kind === "verify") {
    await runVerificationAndRepairPhase(runtime, state);
    return;
  }
  if (taskNode.kind === "inspect") {
    if (!state.contextSelection) await runExplorationPhase(runtime, state);
    else recordRoleNodeExecutionResult(state, runtime.ledger, "explorer", "success", "explorer context selection already available", [], undefined, roleNode.id);
    return;
  }
  if (taskNode.kind === "design" || taskNode.kind === "analyze") {
    completeDesignOrAnalysisTaskNode(runtime.ledger, state, taskNode, roleNode.id);
    recordRoleNodeExecutionResult(state, runtime.ledger, taskNode.ownerRole, "success", `${taskNode.title} produced structured evidence`, [], undefined, roleNode.id);
    return;
  }
  if (taskNode.kind === "summarize") {
    await executeSummarizerNode(runtime, state, taskNode, roleNode);
    return;
  }
  throw new WorkflowBlockedError(`TaskGraph has no executable action for node ${taskNode.id} (${taskNode.kind}).`);
}

async function runPostJudgeAdvisoryIfNeeded(runtime: OfflineGraphRuntime, state: AgentGraphState): Promise<void> {
  if (!state.judge) return;
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
}

function blockScheduledWorkflow(runtime: OfflineGraphRuntime, state: AgentGraphState, role: AgentRole, reason: string): void {
  state.workflowBlockedReason = reason;
  recordRoleNodeExecutionResult(state, runtime.ledger, role, "blocked", reason, [], reason);
  runtime.ledger.append({
    type: "workflow_stop_reason",
    phase: phaseForRole(role),
    role,
    reason,
    result: "aborted"
  });
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
  let coderBScheduled = false;
  if (!livePatchPrimary && allowParallelRoles && config.debate.enabled && config.debate.max_candidates > 1) {
    coderBScheduled = true;
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
        const budgetScope = beginModelInvocationBudgetScope({
          config,
          state,
          ledger,
          invocation: "live_patch",
          phase: "coding",
          label: "live patch",
          plans: patchPlans
        });
        if (!budgetScope) return { candidates: [], notes: [] };
        try {
          const livePatchResult = await runLivePatchCandidates(livePatchInput);
          commitModelInvocationBudgetScope(state, budgetScope, livePatchResult.notes);
          return { candidates: livePatchResult.candidates, notes: livePatchResult.notes };
        } catch (error) {
          releaseModelInvocationBudgetScope(state, budgetScope.reservations, error instanceof Error ? error.message : String(error));
          throw error;
        }
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
    const completedCandidateRoles = new Set<AgentRole>();
    for (const candidate of result.value.candidates) {
      const candidateRole = candidate.agentId as AgentRole;
      if (label === "livePatch") completedCandidateRoles.add(candidateRole);
      recordPatchCandidateEvent(state, ledger, candidateRole, candidate);
    }
    for (const candidateRole of completedCandidateRoles) {
      recordRoleNodeExecutionResult(state, ledger, candidateRole, "success", `${candidateRole} produced live patch candidate(s)`);
    }
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
  if (!coderBScheduled && state.roleGraphExecution?.graph.nodes.some((node) => node.role === "coder_b" && !node.required)) {
    recordRoleNodeExecutionResult(state, ledger, "coder_b", "skipped", "optional coder_b branch was not scheduled by policy or candidate budget");
  }
}

async function runCoderRoleNode(runtime: OfflineGraphRuntime, state: AgentGraphState, role: "coder_a" | "coder_b"): Promise<void> {
  const { access, config, cwd, externalAgents, goal, ledger, options, router } = runtime;
  const coder = new CoderAgent();
  if (role === "coder_a" && state.failureMemory?.coderConstraints.length) {
    recordMemoryRetrieval(state, ledger, "coder_constraints", "coder_a", {
      selectedMemoryIds: uniqueStrings(state.failureMemory.coderConstraints.map((constraint) => constraint.memoryId)),
      rejected: [],
      constraints: state.failureMemory.coderConstraints
    }, `coder-visible memory constraints=${state.failureMemory.coderConstraints.length}`);
  }
  if (role === "coder_a" && options.livePatch && access.cloudAllowed) {
    const livePatchInput = {
      cwd,
      goal,
      config,
      router,
      plan: state.plan!,
      contextSelection: state.contextSelection!,
      visualSpec: state.visualSpec,
      ledger,
      allowParallelRoles: parallelRolesAllowed(state)
    };
    const patchPlans = await buildLivePatchPlans(livePatchInput);
    const budgetScope = beginModelInvocationBudgetScope({
      config,
      state,
      ledger,
      invocation: "live_patch",
      phase: "coding",
      label: "live patch",
      plans: patchPlans
    });
    if (!budgetScope) {
      recordRoleNodeExecutionResult(state, ledger, role, "blocked", "live patch blocked by model invocation budget gate", [], "live patch blocked by model invocation budget gate");
      return;
    }
    try {
      const livePatchResult = await runLivePatchCandidates(livePatchInput);
      commitModelInvocationBudgetScope(state, budgetScope, livePatchResult.notes);
      state.candidates.push(...livePatchResult.candidates);
      for (const candidate of livePatchResult.candidates) {
        recordPatchCandidateEvent(state, ledger, candidate.agentId as AgentRole, candidate);
      }
      if (livePatchResult.notes.length) {
        state.modelNotes.push(...livePatchResult.notes);
        refreshUsageSummary(state);
        recordModelNoteEvents(ledger, livePatchResult.notes, state.usageSummary);
      }
      const completedRoles = new Set(livePatchResult.candidates.map((candidate) => candidate.agentId as AgentRole));
      for (const completedRole of completedRoles) {
        recordRoleNodeExecutionResult(state, ledger, completedRole, "success", `${completedRole} produced live patch candidate(s)`);
      }
      return;
    } catch (error) {
      releaseModelInvocationBudgetScope(state, budgetScope.reservations, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  if (role === "coder_b" && !parallelRolesAllowed(state)) {
    recordRoleNodeExecutionResult(state, ledger, role, "skipped", "coder_b skipped by planningPolicy.allowParallelRoles=false");
    return;
  }
  const candidate = await runCoderCandidate({ cwd, state, ledger, router, externalAgents, coder, role, variant: role === "coder_b" ? "b" : "a", options, config });
  state.candidates.push(candidate);
  recordPatchCandidateEvent(state, ledger, role, candidate);
}

function shouldSkipPostJudgeLiveAdvisory(runtime: OfflineGraphRuntime, state: AgentGraphState): boolean {
  if (!runtime.options.liveAdvisory || !runtime.options.livePatch) return false;
  const selectedId = state.judge?.selectedCandidateId;
  if (!selectedId || state.judge?.decision !== "select") return false;
  const selected = state.candidates.find((candidate) => candidate.candidateId === selectedId);
  return Boolean(selected?.candidateId.startsWith("live_") || selected?.agentId === "coder_a" && selected.summary.toLowerCase().includes("live"));
}

async function runReviewAndJudgePhase(runtime: OfflineGraphRuntime, state: AgentGraphState): Promise<void> {
  await runReviewerRoleNode(runtime, state);
  await runJudgeRoleNode(runtime, state);
}

async function runReviewerRoleNode(runtime: OfflineGraphRuntime, state: AgentGraphState): Promise<void> {
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
  if (!enforceEvidenceGate(state, ledger, validateEvidenceDependencies({
    role: "reviewer",
    candidates: state.candidates,
    evidencePackets: state.evidencePackets
  }))) return;
  if (!enforceTaskNodeGate(state, ledger, state.plan?.riskLevel === "high" ? "security_review" : "review_patch")) return;
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
    recordExternalInvocationEvidence(state, ledger, result, "reviewer");
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
  const reviewPacketRef = recordEvidencePacket(state, ledger, buildReviewEvidence(state.review, reviewRef), "reviewer");
  attachTaskNodeRefs(state, ["review_patch", "security_review"], { evidenceRefs: [reviewPacketRef], artifactRefs: [reviewRef] });
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
  ledger.append({ type: "evidence_update", phase: "review", role: "reviewer", evidence: [`debate rounds=${state.debateRounds.length}`] });
}

async function runJudgeRoleNode(runtime: OfflineGraphRuntime, state: AgentGraphState): Promise<void> {
  const { config, cwd, externalAgents, ledger, router } = runtime;
  const memoryAssessments = state.failureMemory?.reviewAssessments ?? (failureMemoryEnabled(config, "review_guard")
    ? buildCandidateMemoryAssessments(state.candidates, state.failureMemory?.coderConstraints ?? [])
    : []);
  if (!enforceEvidenceGate(state, ledger, validateEvidenceDependencies({
    role: "judge",
    candidates: state.candidates,
    review: state.review,
    evidencePackets: state.evidencePackets
  }))) return;
  if (!enforceTaskNodeGate(state, ledger, "judge_patch")) return;

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
    recordExternalInvocationEvidence(state, ledger, result, "judge");
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
  recordDebateSessionEvents(state, ledger);
  const judgeJson = JSON.stringify(state.judge, null, 2);
  const decisionRef = ledger.writeArtifact("judge_decisions", judgeJson, "json");
  recordArtifactProjection(state, ledger, "judge", decisionRef, judgeJson, "judge", "judge");
  const judgePacketRef = recordEvidencePacket(state, ledger, buildJudgeEvidence(state.judge, decisionRef), "judge");
  attachTaskNodeRefs(state, "judge_patch", { evidenceRefs: [judgePacketRef], artifactRefs: [decisionRef] });
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
    unresolvedIssueIds: state.judge.unresolvedIssueIds,
    selectedCandidateBlockingIssues: state.judge.selectedCandidateBlockingIssues,
    globalBlockingIssues: state.judge.globalBlockingIssues,
    nonSelectedCandidateIssues: state.judge.nonSelectedCandidateIssues,
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
    const budgetScope = beginModelInvocationBudgetScope({
      config,
      state,
      ledger,
      invocation: "live_advisory",
      phase: "planning",
      label: "live advisory",
      plans: advisoryPlans
    });
    if (budgetScope) {
      let advisoryNotes: ModelNote[] = [];
      try {
        advisoryNotes = await runLiveAdvisory(advisoryInput);
        commitModelInvocationBudgetScope(state, budgetScope, advisoryNotes);
      } catch (error) {
        releaseModelInvocationBudgetScope(state, budgetScope.reservations, error instanceof Error ? error.message : String(error));
        throw error;
      }
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
  if (stopBeforePatchApplication(runtime, state)) return;
  if (!enforceEvidenceGate(state, ledger, validateEvidenceDependencies({
    role: "runner",
    candidates: state.candidates,
    judge: state.judge,
    evidencePackets: state.evidencePackets
  }))) return;
  if (!enforceTaskNodeGate(state, ledger, "apply_patch")) return;
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
    attachTaskNodeRefs(state, "apply_patch", { artifactRefs: diffRef ? [diffRef] : [] });
    recordRoleNodeExecutionResult(state, ledger, "runner", "success", "dryRun=true recorded selected patch without mutating files", [], undefined, "patch_runner");
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
        attachTaskNodeRefs(state, "apply_patch", { artifactRefs: [diffRef] });
        recordOutcomeObservation(ledger, prediction, "applied", `${applyResult.changedFiles.length} file(s) changed.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ledger.append({ type: "patch_apply", phase: "patch", role: "runner", provider: "local_tool", model: "patch", candidateId: selected.candidateId, filesChanged: selected.filesChanged, diffRef, undoSnapshotIds: [], applied: false, error: message });
        attachTaskNodeRefs(state, "apply_patch", { artifactRefs: [diffRef] });
        recordOutcomeObservation(ledger, prediction, "blocked", message);
        state.agents.push({
          id: "approval_patch",
          role: "runner",
          provider: "local_tool",
          model: "approval_gate",
          status: "waiting_for_user",
          summary: error instanceof Error ? error.message : String(error)
        });
        if (isApprovalRequiredError(error)) {
          recordRoleNodeExecutionResult(state, ledger, "runner", "skipped", `patch_runner awaits user approval: ${message}`, [], undefined, "patch_runner");
        }
      }
    } else {
      const reason = selected
        ? `Judge selected candidate ${selected.candidateId} but it has no unified diff to apply.`
        : `Judge selected candidate ${state.judge.selectedCandidateId} but it was not found in the candidate list.`;
      const prediction = selected
        ? recordPatchApplicationPrediction(ledger, selected, "patch", false, "Selected candidate has no unified diff to apply.")
        : undefined;
      ledger.append({ type: "patch_apply", phase: "patch", role: "runner", provider: "local_tool", model: "patch", candidateId: state.judge.selectedCandidateId, filesChanged: [], diffRef: undefined, undoSnapshotIds: [], applied: false, error: reason });
      attachTaskNodeRefs(state, "apply_patch", { artifactRefs: [] });
      if (prediction) recordOutcomeObservation(ledger, prediction, "blocked", reason);
      recordRoleNodeExecutionResult(state, ledger, "runner", "blocked", reason, [], reason, "patch_runner");
    }
  }
}

function stopBeforePatchApplication(runtime: OfflineGraphRuntime, state: AgentGraphState): boolean {
  const decision = state.judge?.decision;
  if (!decision || decision === "select") return false;
  const reason = decision === "request_revision"
    ? `Judge requested revision before patch application: ${state.judge?.reason ?? "No candidate was approved for automatic application."}`
    : decision === "ask_user"
      ? `Judge requires user decision before patch application: ${state.judge?.reason ?? "A user decision is required before applying changes."}`
      : `Judge aborted patch application: ${state.judge?.reason ?? "Patch application was aborted."}`;
  state.workflowBlockedReason = reason;
  if (state.roleGraphExecution) {
    recordRoleNodeExecutionResult(state, runtime.ledger, "runner", "skipped", reason, [], undefined, "patch_runner");
  }
  runtime.ledger.append({
    type: "workflow_stop_reason",
    phase: "judge",
    role: "judge",
    reason,
    result: "aborted"
  });
  return true;
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
  if (!state.changedFiles.length || !testCommands.length) {
    if (!enforceTaskNodeGate(state, ledger, "verify_patch")) return;
    const reason = !state.changedFiles.length
      ? "test_runner skipped because no patch was applied in this workflow path."
      : "test_runner skipped because no verification command was available.";
    recordRoleNodeExecutionResult(state, ledger, "runner", "skipped", reason, [], undefined, "test_runner");
    return;
  }
  if (state.changedFiles.length && testCommands.length) {
    try {
      for (const testCommand of testCommands) {
        if (!canContinueAutonomy(config, state, ledger, startedAtMs, "shell")) return;
        if (!contractAllowsShell(state, ledger)) return;
        if (!canRunShell(config, state, shellRuns, ledger)) return;
        if (!enforceTaskNodeGate(state, ledger, "verify_patch")) return;
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
        if (!enforceEvidenceGate(state, ledger, validateEvidenceDependencies({
          role: "repairer",
          runResults: state.runResults,
          changedFiles: state.changedFiles,
          evidencePackets: state.evidencePackets
        }))) return;
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
      if (isApprovalRequiredError(error)) {
        recordRoleNodeExecutionResult(state, ledger, "runner", "skipped", `test_runner awaits user approval: ${error instanceof Error ? error.message : String(error)}`, [], undefined, "test_runner");
      }
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
    recordExternalInvocationEvidence(input.state, input.ledger, result, input.role);
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
  const strict = profile.normalizationStrictness === "strict";
  const error = strict
    ? `External ${role} result was unparseable as ${expected}; strict normalization blocks native fallback.`
    : `External ${role} result was unparseable as ${expected}; falling back to ${fallback}.`;
  ledger.append({
    type: "external_agent_error",
    phase: phaseForRole(role),
    role,
    provider: `external:${profile.id}`,
    model: profile.name,
    externalAgentId: profile.id,
    error
  });
  if (strict) throw new WorkflowBlockedError(error);
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

function recordExternalInvocationEvidence(state: AgentGraphState, ledger: EventLedger, result: { evidencePackets?: EvidencePacket[] }, role: AgentRole): void {
  for (const packet of result.evidencePackets ?? []) {
    recordEvidencePacket(state, ledger, packet, role);
  }
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
  const workflowKind = workflowKindValue(object.workflowKind);
  return {
    goal: stringOr(object.goal, goal),
    constraints: stringArray(object.constraints),
    riskLevel: riskLevel(object.riskLevel),
    taskType: taskType(object.taskType),
    workflowKind,
    requiresPatchWorkflow: workflowKind ? !["read_only", "advisory", "ask_user"].includes(workflowKind) : undefined,
    steps,
    taskGraph: parseTaskGraphCandidate(object.taskGraph),
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

function workflowKindValue(value: unknown): Plan["workflowKind"] {
  return ["read_only", "patch", "repair", "vision_patch", "advisory", "ask_user"].includes(String(value)) ? value as Plan["workflowKind"] : undefined;
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
  if (!state.finalSummary) await executeSummarizerNode(runtime, state);
  await appendFinalSummaryEvents(state, runtime.ledger, runtime);
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

async function finalizeBlockedByEvidenceGate(runtime: OfflineGraphRuntime, state: AgentGraphState, reason: string): Promise<AgentGraphState> {
  const { ledger } = runtime;
  if (state.judge?.decision === "request_revision" || state.judge?.decision === "ask_user" || state.judge?.decision === "abort") {
    const userReply = state.judge.decision === "request_revision"
      ? `I stopped before applying changes because review and judgment did not clear any patch candidate for safe automatic application. ${state.judge.reason}`
      : state.judge.decision === "ask_user"
        ? `I stopped before applying changes because the judge requires a user decision. ${state.judge.reason}`
        : `I stopped before applying changes because the judge aborted the workflow. ${state.judge.reason}`;
    const risksRemaining = state.judge.decision === "ask_user"
      ? ["A user decision is still required before any patch can be applied."]
      : ["No patch candidate was approved for application."];
    state.finalSummary = {
      task: state.goal,
      result: "aborted",
      userReply,
      userReplySource: "blocked",
      changedFiles: state.changedFiles,
      testsRun: state.runResults.map((result) => result.command),
      evidence: [
        reason,
        state.judge.reason,
        ...state.evidencePackets.map((packet) => packet.summary)
      ],
      risksRemaining,
      suggestedCommitMessage: "chore: no code changes"
    };
    await appendFinalSummaryEvents(state, ledger, runtime);
    await releaseExternalAgentProcessPool();
    return state;
  }
  state.finalSummary = {
    task: state.goal,
    result: "aborted",
    userReply: `I blocked this workflow because required evidence was missing before a governed action. ${reason}`,
    userReplySource: "blocked",
    changedFiles: state.changedFiles,
    testsRun: state.runResults.map((result) => result.command),
    evidence: [reason, ...state.evidencePackets.map((packet) => packet.summary)],
    risksRemaining: ["unsafe/blocked/advisory: evidence dependency gate blocked the workflow before continuing."],
    suggestedCommitMessage: state.changedFiles.length ? `chore: review blocked changes in ${state.changedFiles[0]}` : "chore: no code changes"
  };
  ledger.append({
    type: "workflow_stop_reason",
    phase: "judge",
    role: "judge",
    reason,
    result: "aborted"
  });
  await appendFinalSummaryEvents(state, ledger, runtime);
  await releaseExternalAgentProcessPool();
  return state;
}

async function executeSummarizerNode(runtime: OfflineGraphRuntime, state: AgentGraphState, taskNode?: TaskGraphNode, roleNode?: RoleNode): Promise<void> {
  if (state.finalSummary) return;
  assertSummarizerNodeReady(state, taskNode, roleNode);
  if (isReadOnlyPlan(state.plan!)) {
    await executeReadOnlySummarizerNode(runtime, state);
    return;
  }
  const { ledger, router } = runtime;
  const summarizer = new SummarizerAgent();
  try {
    state.finalSummary = await runAgentState(state, ledger, router, "summarizer", () =>
      summarizer.run({
        plan: state.plan!,
        changedFiles: state.changedFiles,
        testsRun: state.runResults.map((result) => result.command),
        evidence: summaryEvidenceForState(state)
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
      evidence: ["summarizer failed; system diagnostic summary generated", ...summaryEvidenceForState(state)],
      risksRemaining: [`summarizer failed: ${message}`],
      suggestedCommitMessage: `chore: update ${state.changedFiles[0] ?? "workspace"}`
    };
  }
}

async function executeReadOnlySummarizerNode(runtime: OfflineGraphRuntime, state: AgentGraphState): Promise<void> {
  const { cwd, ledger, router } = runtime;
  const summarized = await runAgentState(state, ledger, router, "summarizer", async () => {
    const result = await buildReadOnlyTaskResult(cwd, state.plan!, state.contextSelection);
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
    return { result, reply, evidenceRef, replyRef };
  }, "offline");
  state.finalSummary = {
    task: state.goal,
    result: summarized.reply.source === "model" ? "completed" : "failed",
    userReply: summarized.reply.text,
    userReplySource: summarized.reply.source,
    changedFiles: [],
    testsRun: [],
    evidence: summarized.result.evidence,
    risksRemaining: summarized.reply.source === "model" ? [] : [summarized.reply.error ?? "No model-backed user reply was produced."],
    suggestedCommitMessage: "chore: no code changes"
  };
  attachSummaryTaskNodeRefs(state, {
    evidenceRefs: [summarized.evidenceRef, summarized.replyRef],
    artifactRefs: [summarized.evidenceRef, summarized.replyRef]
  });
}

function assertSummarizerNodeReady(state: AgentGraphState, taskNode?: TaskGraphNode, roleNode?: RoleNode): void {
  if (!state.roleGraphExecution) return;
  const node = roleNode ?? state.roleGraphExecution.graph.nodes.find((item) => item.id === "summarizer");
  if (!node) return;
  const ready = readyRoleNodes(state.roleGraphExecution).some((item) => item.id === node.id);
  const readyTask = taskNode ?? readyTaskNodeForRoleNode(state.plan?.taskGraph, node);
  if (!ready || !readyTask) {
    const roleState = state.roleGraphExecution.nodes[node.id]?.status ?? "missing";
    const readyTasks = state.plan?.taskGraph ? nextReadyTaskNodes(state.plan.taskGraph).map((item) => item.id).join(", ") : "none";
    throw new WorkflowBlockedError(`Summarizer cannot run before dependencies are terminal. roleState=${roleState} readyTasks=${readyTasks}`);
  }
}

function summaryEvidenceForState(state: AgentGraphState): string[] {
  const skippedOrBlocked = state.roleGraphExecution?.results
    .filter((result) => result.status === "skipped" || result.status === "blocked")
    .map((result) => `${result.nodeId ?? result.role} ${result.status}: ${result.summary}`) ?? [];
  const taskSkips = state.events
    .filter((event): event is Extract<TomorrowEdgeEvent, { type: "task_node_result" }> => event.type === "task_node_result")
    .filter((event) => event.status === "skipped" || event.status === "blocked")
    .map((event) => `${event.taskNodeId} ${event.status}: ${event.summary}`);
  return uniqueStrings([
    "offline graph completed",
    ...(state.visualSpec ? [`capability stitching visual spec: ${state.visualSpec.summary}`] : []),
    ...state.evidencePackets.map((packet) => packet.summary),
    ...state.runResults.map(evidenceFromRun),
    ...skippedOrBlocked,
    ...taskSkips
  ]);
}

async function finalizeReadOnlyState(runtime: OfflineGraphRuntime, state: AgentGraphState): Promise<AgentGraphState> {
  skipOptionalReadOnlyGovernanceNodes(state, runtime.ledger);
  ensureReadOnlySummarizerTaskNode(state, runtime.ledger);
  await executeSummarizerNode(runtime, state);
  await appendFinalSummaryEvents(state, runtime.ledger, runtime);
  await releaseExternalAgentProcessPool();
  return state;
}

function ensureReadOnlySummarizerTaskNode(state: AgentGraphState, ledger: EventLedger): void {
  const graph = state.plan?.taskGraph;
  if (!graph) return;
  const existingReady = graph.nodes.some((node) => node.kind === "summarize" && node.status === "pending" && node.dependsOn.every((dependency) => {
    const dep = graph.nodes.find((item) => item.id === dependency);
    return dep?.status === "done" || dep?.status === "skipped";
  }));
  if (existingReady) return;
  const dependencies = graph.nodes
    .filter((node) => node.ownerRole !== "summarizer" && (node.status === "done" || node.status === "skipped"))
    .map((node) => node.id);
  const existing = graph.nodes.find((node) => node.kind === "summarize");
  const node: TaskGraphNode = existing ?? {
    id: "summarize_findings",
    kind: "summarize",
    title: "Summarize findings",
    objective: "Return a bounded answer after read-only inspection.",
    detail: "Return a bounded answer after read-only inspection.",
    phase: "summary",
    ownerRole: "summarizer",
    roleHints: ["summarizer"],
    dependsOn: [],
    dependencies: [],
    requiredInputs: [{ id: "context_summary", kind: "file", description: "Read-only context summary", required: false }],
    expectedOutputs: [{ id: "final_answer", kind: "summary", description: "Final read-only answer" }],
    requiredEvidence: ["Read-only context summary"],
    expectedArtifacts: ["Final read-only answer"],
    riskLevel: state.plan?.riskLevel ?? "low",
    mutationAllowed: false,
    canRunInParallel: false,
    stopIfFails: true,
    acceptanceCriteria: state.objectiveContract?.successCriteria ?? state.plan?.steps.map((step) => step.title) ?? [],
    status: "pending"
  };
  node.dependsOn = dependencies;
  node.dependencies = dependencies;
  node.status = "pending";
  if (!existing) graph.nodes.push(node);
  graph.edges = graph.edges.filter((edge) => edge.to !== node.id);
  graph.edges.push(...dependencies.map((from) => ({ from, to: node.id, reason: "Read-only summary requires completed inspection or clarification evidence" })));
  graph.terminalNodeIds = [node.id];
  ledger.append({
    type: "evidence_gap",
    phase: "summary",
    role: "summarizer",
    missing: ["read-only summarize task node"],
    blocking: false,
    reason: "Read-only TaskGraph was repaired to include an executable summarizer node."
  });
}

function skipOptionalReadOnlyGovernanceNodes(state: AgentGraphState, ledger: EventLedger): void {
  if (!state.roleGraphExecution) return;
  if (state.roleGraphExecution.graph.workflowKind !== "read_only" && state.roleGraphExecution.graph.workflowKind !== "advisory") return;
  for (const role of ["reviewer", "judge"] as AgentRole[]) {
    const node = state.roleGraphExecution.graph.nodes.find((item) => item.role === role);
    if (!node || node.required) continue;
    const status = state.roleGraphExecution.nodes[node.id]?.status;
    if (status === "pending" || status === "ready" || status === "running") {
      recordRoleNodeExecutionResult(state, ledger, role, "skipped", `${role} skipped for read-only finalization; no governed advisory was requested`);
    }
  }
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
  const summaryRef = ledger.writeArtifact("summaries", JSON.stringify(state.finalSummary, null, 2), "json");
  attachSummaryTaskNodeRefs(state, { evidenceRefs: [summaryRef], artifactRefs: [summaryRef] });
  ledger.append({
    type: "summary",
    phase: "summary",
    role: "summarizer",
    summaryRef,
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
  const traceCompletenessRef = ledger.writeArtifact("trace_completeness", JSON.stringify(state.traceCompleteness, null, 2), "json");
  attachSummaryTaskNodeRefs(state, { evidenceRefs: [traceCompletenessRef], artifactRefs: [traceCompletenessRef] });
  ledger.append({
    type: "trace_completeness",
    phase: "summary",
    role: "summarizer",
    score: state.traceCompleteness.score,
    missing: state.traceCompleteness.missing,
    intentionallySkipped: state.traceCompleteness.intentionallySkipped,
    blockedByApproval: state.traceCompleteness.blockedByApproval,
    workflowKind,
    traceCompletenessRef
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
  attachSummaryTaskNodeRefs(state, { evidenceRefs: [traceRef], artifactRefs: [traceRef] });
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
      ? {
        score: state.traceCompleteness.score,
        missing: state.traceCompleteness.missing,
        intentionallySkipped: state.traceCompleteness.intentionallySkipped,
        blockedByApproval: state.traceCompleteness.blockedByApproval
      }
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
  const budgetScope = beginModelInvocationBudgetScope({
    config: input.config,
    state: input.state,
    ledger: input.ledger,
    invocation: "live_advisory",
    phase: "planning",
    label: "governed read-only advisory",
    plans: advisoryPlans
  });
  if (!budgetScope) {
    return;
  }
  let advisoryNotes: ModelNote[] = [];
  try {
    advisoryNotes = await runLiveAdvisory(advisoryInput);
    commitModelInvocationBudgetScope(input.state, budgetScope, advisoryNotes);
  } catch (error) {
    releaseModelInvocationBudgetScope(input.state, budgetScope.reservations, error instanceof Error ? error.message : String(error));
    throw error;
  }
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
  const budgetScope = beginModelInvocationBudgetScope({
    config: input.config,
    state: input.state,
    ledger: input.ledger,
    invocation: "pre_judge_debate",
    phase: "judge",
    label: "pre-judge model debate",
    plans: advisoryPlans
  });
  if (!budgetScope) {
    input.ledger.append({
      type: "evidence_update",
      phase: "review",
      role: "reviewer",
      evidence: ["pre-judge model debate blocked by unified budget gate"]
    });
    return;
  }
  let notes: ModelNote[] = [];
  try {
    notes = await runLiveAdvisoryForRoles(advisoryInput, roles);
    commitModelInvocationBudgetScope(input.state, budgetScope, notes);
  } catch (error) {
    releaseModelInvocationBudgetScope(input.state, budgetScope.reservations, error instanceof Error ? error.message : String(error));
    throw error;
  }
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

function enforceEvidenceGate(state: AgentGraphState, ledger: EventLedger, gaps: EvidenceDependencyGap[]): boolean {
  recordEvidenceGaps(ledger, gaps);
  const blocking = gaps.filter((gap) => gap.blocking);
  if (!blocking.length) return true;
  const role = blocking[0]!.role;
  const reason = `Evidence gate blocked ${role}: ${blocking.map((gap) => `${gap.missing} (${gap.reason})`).join("; ")}`;
  state.workflowBlockedReason = reason;
  recordRoleNodeExecutionResult(state, ledger, role, "blocked", reason, [], reason);
  ledger.append({
    type: "workflow_stop_reason",
    phase: phaseForRole(role),
    role,
    reason,
    result: "aborted"
  });
  return false;
}

function recordDebateSessionEvents(state: AgentGraphState, ledger: EventLedger): void {
  const session = state.debateSession;
  if (!session) return;
  const selectedCandidateId = state.judge?.selectedCandidateId;
  const selectedCandidateResolution = selectedCandidateId
    ? session.candidateResolutions[selectedCandidateId]?.resolution
    : undefined;
  const nonSelectedIssueCount = session.unresolvedIssues.filter((issue) =>
    issue.candidateId && issue.candidateId !== selectedCandidateId
  ).length;
  const selectedIssueCount = session.unresolvedIssues.filter((issue) =>
    selectedCandidateId && issue.candidateId === selectedCandidateId
  ).length;
  const globalIssueCount = session.unresolvedIssues.filter((issue) => !issue.candidateId).length;
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
    selectedCandidateId,
    selectedCandidateResolution,
    globalResolution: session.globalResolution.resolution,
    selectedIssueCount,
    globalIssueCount,
    nonSelectedIssueCount,
    acceptedClaims: session.acceptedClaims,
    rejectedClaims: session.rejectedClaims,
    unresolvedBlockingIssues: session.unresolvedBlockingIssues,
    unresolvedIssues: session.unresolvedIssues,
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
  error?: string,
  nodeId?: string
): void {
  if (!state.roleGraphExecution) return;
  const result = { nodeId, role, status, summary, artifacts, evidence: summary ? [summary] : [], error };
  const execution = status === "success"
    ? completeRoleNode(state.roleGraphExecution, role, { nodeId, summary, artifacts, evidence: summary ? [summary] : [], error }, nodeId)
    : status === "blocked"
      ? blockRoleNode(state.roleGraphExecution, role, summary, nodeId)
      : status === "skipped"
        ? skipRoleNode(state.roleGraphExecution, role, summary, nodeId)
        : markRoleNodeResult(state.roleGraphExecution, result);
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
  updateTaskGraphForRoleNode(state, ledger, execution.nodeId, role, status, summary, artifacts, error);
}

function enforceTaskNodeGate(state: AgentGraphState, ledger: EventLedger, taskNodeId: string): boolean {
  const taskNode = state.plan?.taskGraph?.nodes.find((node) => node.id === taskNodeId);
  if (!taskNode) return true;
  return enforceEvidenceGate(state, ledger, validateEvidenceForTaskNode({
    role: taskNode.ownerRole,
    taskNode,
    taskGraph: state.plan?.taskGraph,
    candidates: state.candidates,
    review: state.review,
    judge: state.judge,
    evidencePackets: state.evidencePackets,
    runResults: state.runResults,
    changedFiles: state.changedFiles
  }));
}

function updateTaskGraphForRoleNode(
  state: AgentGraphState,
  ledger: EventLedger,
  roleNodeId: string,
  role: AgentRole,
  status: "success" | "failed" | "blocked" | "skipped",
  summary: string,
  artifacts: string[] = [],
  error?: string
): void {
  const graph = state.plan?.taskGraph;
  if (!graph) return;
  const taskStatus = status === "success" ? "done" : status === "failed" || status === "blocked" ? "blocked" : "skipped";
  const candidates = graph.nodes.filter((node) => taskNodeMatchesRoleNode(node.id, node.kind, node.ownerRole, roleNodeId, role));
  for (const node of candidates) {
    if (taskStatus === "done" && !node.dependsOn.every((dependency) => graph.nodes.find((item) => item.id === dependency)?.status === "done" || graph.nodes.find((item) => item.id === dependency)?.status === "skipped")) {
      continue;
    }
    node.status = taskStatus;
    ledger.append({
      type: "task_node_result",
      phase: node.phase,
      role: node.ownerRole,
      taskNodeId: node.id,
      roleNodeId,
      status: taskStatus,
      summary,
      evidence: summary ? [summary, ...artifacts] : artifacts,
      artifacts,
      evidenceRef: artifacts[0],
      error
    });
  }
  flushReadyTaskGraphNodes(state, ledger);
}

function markTaskNodesRunning(state: AgentGraphState, ledger: EventLedger, roleNodeId: string, role: AgentRole, summary: string): void {
  const graph = state.plan?.taskGraph;
  if (!graph) return;
  for (const node of graph.nodes.filter((item) => taskNodeMatchesRoleNode(item.id, item.kind, item.ownerRole, roleNodeId, role) && item.status === "pending")) {
    node.status = "running";
    ledger.append({
      type: "task_node_result",
      phase: node.phase,
      role: node.ownerRole,
      taskNodeId: node.id,
      roleNodeId,
      status: "running",
      summary,
      evidence: [],
      artifacts: []
    });
  }
}

function completeDesignOrAnalysisTaskNode(ledger: EventLedger, state: AgentGraphState, node: TaskGraphNode, roleNodeId?: string): void {
  const graph = state.plan?.taskGraph;
  if (!graph || node.status === "done") return;
  const result = designOrRiskArtifactForNode(state, node);
  const artifactRef = ledger.writeArtifact(result.kind === "risk_map" ? "risk_maps" : "designs", JSON.stringify(result.artifact, null, 2), "json");
  const packet = buildEvidencePacket({
    phase: "plan",
    summary: result.summary,
    claims: result.claims,
    supportingArtifacts: [artifactRef],
    riskSignals: result.riskSignals,
    verificationStatus: "partial"
  });
  const packetRef = recordEvidencePacket(state, ledger, packet, node.ownerRole);
  attachTaskNodeRefs(state, node.id, { evidenceRefs: [packetRef], artifactRefs: [artifactRef] });
  node.status = "done";
  ledger.append({
    type: "task_node_result",
    phase: node.phase,
    role: node.ownerRole,
    taskNodeId: node.id,
    roleNodeId,
    status: "done",
    summary: result.summary,
    evidence: result.claims,
    artifacts: [artifactRef],
    evidenceRef: artifactRef
  });
}

function designOrRiskArtifactForNode(state: AgentGraphState, node: TaskGraphNode): {
  kind: "design_patch" | "risk_map";
  summary: string;
  claims: string[];
  riskSignals: string[];
  artifact: Record<string, unknown>;
} {
  const selectedFiles = state.contextSelection?.selectedFiles.map((file) => file.path) ?? state.plan?.expectedFiles ?? [];
  const acceptanceCriteria = node.acceptanceCriteria.length ? node.acceptanceCriteria : state.objectiveContract?.successCriteria ?? [];
  if (node.id === "risk_map") {
    const securityBoundary = uniqueStrings([
      ...(state.objectiveContract?.allowedTools.map((tool) => `allowed tool: ${tool}`) ?? []),
      ...(state.objectiveContract?.forbiddenActions.map((action) => `forbidden action: ${action}`) ?? []),
      ...(state.scenarioProfile?.riskSignals ?? [])
    ]);
    const regressionBoundary = uniqueStrings([
      ...selectedFiles.map((file) => `selected file: ${file}`),
      ...(state.plan?.verificationCommands ?? []).map((command) => `verification: ${command}`)
    ]);
    const requiredReviewEvidence = uniqueStrings([
      "risk_map artifact",
      "candidate diff",
      "review_decision",
      "judge_decision",
      ...(state.plan?.verificationCommands?.length ? ["verification output"] : ["explicit no-verifier or approval-blocked reason"])
    ]);
    return {
      kind: "risk_map",
      summary: "risk_map produced structured high-risk review evidence",
      claims: [
        `security boundary items=${securityBoundary.length}`,
        `regression boundary items=${regressionBoundary.length}`,
        `required review evidence=${requiredReviewEvidence.join(" | ")}`
      ],
      riskSignals: securityBoundary,
      artifact: {
        taskNodeId: node.id,
        workflowKind: state.workflowKind,
        riskLevel: state.plan?.riskLevel,
        securityBoundary,
        regressionBoundary,
        requiredReviewEvidence,
        acceptanceCriteria
      }
    };
  }
  const patchStrategy = uniqueStrings([
    ...((state.plan?.steps ?? []).map((step) => `${step.id}: ${step.title}`)),
    state.visualSpec ? `vision handoff: ${state.visualSpec.summary}` : ""
  ]);
  const riskAssumptions = uniqueStrings([
    `plan risk=${state.plan?.riskLevel ?? "unknown"}`,
    `workflowKind=${state.workflowKind ?? state.plan?.workflowKind ?? "unknown"}`,
    ...(state.objectiveContract?.forbiddenActions.map((action) => `must avoid ${action}`) ?? [])
  ]);
  return {
    kind: "design_patch",
    summary: "design_patch produced structured patch strategy evidence",
    claims: [
      `files likely to touch=${selectedFiles.join(", ") || "not yet known"}`,
      `patch strategy steps=${patchStrategy.length}`,
      `acceptance criteria=${acceptanceCriteria.join(" | ") || "not specified"}`
    ],
    riskSignals: riskAssumptions,
    artifact: {
      taskNodeId: node.id,
      filesLikelyToTouch: selectedFiles,
      patchStrategy,
      riskAssumptions,
      acceptanceCriteria
    }
  };
}

function taskNodeMatchesRoleNode(taskNodeId: string, kind: string, ownerRole: AgentRole, roleNodeId: string, role: AgentRole): boolean {
  if (roleNodeId === "patch_runner") return kind === "apply_patch";
  if (roleNodeId === "test_runner") return kind === "verify";
  if (roleNodeId === "coder_a") return ownerRole === "coder_a";
  if (roleNodeId === "coder_b") return ownerRole === "coder_b";
  if (roleNodeId === "reviewer") return ownerRole === "reviewer" || kind === "review";
  if (roleNodeId === "judge") return ownerRole === "judge" || kind === "judge";
  if (roleNodeId === "explorer") return ownerRole === "explorer" || kind === "inspect" || taskNodeId === "inspect_context";
  if (roleNodeId === "planner") return ownerRole === "planner" || kind === "design";
  if (roleNodeId === "summarizer") return ownerRole === "summarizer" || kind === "summarize";
  return ownerRole === role;
}

function taskGraphMatchesRoleGraph(taskGraph: TaskGraph, roleGraph: { nodes: RoleNode[] }): boolean {
  const roleGraphHasCoderB = roleGraph.nodes.some((node) => node.id === "coder_b");
  const taskGraphHasCoderB = taskGraph.nodes.some((node) => node.id === "produce_patch_alt" && node.ownerRole === "coder_b");
  return roleGraphHasCoderB === taskGraphHasCoderB;
}

function flushReadyTaskGraphNodes(state: AgentGraphState, ledger: EventLedger): void {
  const graph = state.plan?.taskGraph;
  if (!graph || !state.roleGraphExecution) return;
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of graph.nodes) {
      if (node.status !== "pending") continue;
      if (!node.dependsOn.every((dependency) => {
        const dep = graph.nodes.find((item) => item.id === dependency);
        return dep?.status === "done" || dep?.status === "skipped";
      })) continue;
      const ownerDone = Object.values(state.roleGraphExecution.nodes).some((roleNode) =>
        roleNode.role === node.ownerRole && (roleNode.status === "success" || roleNode.status === "skipped")
      );
      if (!ownerDone) continue;
      if (node.kind === "apply_patch" || node.kind === "verify" || node.kind === "summarize") continue;
      if (node.kind === "design" || node.kind === "analyze") {
        completeDesignOrAnalysisTaskNode(ledger, state, node);
        changed = true;
        continue;
      }
      node.status = "done";
      changed = true;
      ledger.append({
        type: "task_node_result",
        phase: node.phase,
        role: node.ownerRole,
        taskNodeId: node.id,
        status: "done",
        summary: `${node.id} completed after dependencies became available`,
        evidence: [],
        artifacts: []
      });
    }
  }
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
    const providerReality = budgetProviderReality(assignment.provider);
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
      strongAgentCallsRemaining: gate.remainingCalls,
      realStrongAgentCallsUsed: state.budgetRuntime.realStrongAgentCallsUsed,
      simulatedStrongAgentCallsUsed: state.budgetRuntime.simulatedStrongAgentCallsUsed,
      realProvider: providerReality.realProvider,
      simulated: providerReality.simulated
    });
    if (gate.action !== "allow") {
      state.budgetRuntime.blockedRoles[role] = gate.reason;
      if (options.budgetFallback) {
        recordBlockedAgentRun(state, ledger, role, assignment, effectiveAgentKind, gate, false);
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
      recordBlockedAgentRun(state, ledger, role, assignment, effectiveAgentKind, gate, true);
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
  const roleNodeExecution = state.roleGraphExecution ? beginRoleNode(state.roleGraphExecution, role) : undefined;
  if (state.roleGraphExecution && !roleNodeExecution && state.roleGraphExecution.graph.nodes.some((node) => node.role === role && ["pending", "ready", "running"].includes(state.roleGraphExecution!.nodes[node.id]?.status ?? "pending"))) {
    throw new WorkflowBlockedError(`RoleGraph blocked ${role}: dependencies are not satisfied for the next ${role} node.`);
  }
  if (roleNodeExecution) markTaskNodesRunning(state, ledger, roleNodeExecution.nodeId, role, `${role} started`);
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
    const approvalRequired = isApprovalRequiredError(error);
    agentState.status = "failed";
    agentState.summary = error instanceof Error ? error.message : String(error);
    updateCapabilityStep(state, role, "blocked", agentState.summary);
    if (approvalRequired) {
      agentState.status = "waiting_for_user";
    } else {
      recordRoleNodeExecutionResult(state, ledger, role, "failed", agentState.summary, [], agentState.summary);
    }
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
    if (effectiveAgentKind === "external") {
      throw new WorkflowBlockedError(`External ${role} invocation failed: ${agentState.summary}`);
    }
    throw error;
  } finally {
    agentState.endedAt = nowIso();
    agentState.elapsedMs = Date.now() - start;
  }
}

function isApprovalRequiredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("approval required");
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

function recordBlockedAgentRun(state: AgentGraphState, ledger: EventLedger, role: AgentRole, assignment: RouteAssignment, agentKind: AgentRunState["agentKind"], gate: BudgetGateDecision, markRoleGraph = true): void {
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
  if (markRoleGraph) recordRoleNodeExecutionResult(state, ledger, role, "blocked", gate.reason, [], gate.reason);
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
  const packetRef = recordEvidencePacket(state, ledger, buildPatchEvidence(candidate, diffRef), role);
  if (role === "coder_a") attachTaskNodeRefs(state, "produce_patch", { evidenceRefs: [packetRef], artifactRefs: diffRef ? [diffRef] : [] });
  if (role === "coder_b") attachTaskNodeRefs(state, "produce_patch_alt", { evidenceRefs: [packetRef], artifactRefs: diffRef ? [diffRef] : [] });
  if (role === "repairer") attachTaskNodeRefs(state, "produce_repair", { evidenceRefs: [packetRef], artifactRefs: diffRef ? [diffRef] : [] });
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
  const packetRef = recordEvidencePacket(state, ledger, buildTestEvidence(result, { stdoutRef, stderrRef }), "runner");
  attachTaskNodeRefs(state, ["verify_patch", "verify_repair", "verify_failed"], { evidenceRefs: [packetRef], artifactRefs: [stdoutRef, stderrRef] });
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

function recordEvidencePacket(state: AgentGraphState, ledger: EventLedger, packet: EvidencePacket, role?: AgentRole): string {
  state.evidencePackets.push(packet);
  const packetRef = ledger.writeArtifact("evidence_packets", JSON.stringify(packet, null, 2), "json");
  ledger.append({
    type: "evidence_packet",
    phase: packet.phase === "plan" ? "planning" : packet.phase === "patch" ? "coding" : packet.phase === "test" ? "verification" : packet.phase,
    role,
    packetId: packet.id,
    evidencePhase: packet.phase,
    summary: packet.summary,
    verificationStatus: packet.verificationStatus,
    supportingArtifacts: packet.supportingArtifacts,
    packetRef
  });
  return packetRef;
}

function attachTaskNodeRefs(state: AgentGraphState, taskNodeIds: string | string[], refs: { evidenceRefs?: string[]; artifactRefs?: string[] }): void {
  const graph = state.plan?.taskGraph;
  if (!graph) return;
  const ids = Array.isArray(taskNodeIds) ? taskNodeIds : [taskNodeIds];
  for (const id of ids) {
    const node = graph.nodes.find((item) => item.id === id);
    if (!node) continue;
    node.evidenceRefs = uniqueStrings([...(node.evidenceRefs ?? []), ...(refs.evidenceRefs ?? [])]);
    node.artifactRefs = uniqueStrings([...(node.artifactRefs ?? []), ...(refs.artifactRefs ?? [])]);
  }
}

function attachSummaryTaskNodeRefs(state: AgentGraphState, refs: { evidenceRefs?: string[]; artifactRefs?: string[] }): void {
  const graph = state.plan?.taskGraph;
  const summaryNodeIds = graph?.nodes.filter((node) => node.kind === "summarize").map((node) => node.id) ?? [];
  attachTaskNodeRefs(state, summaryNodeIds.length ? summaryNodeIds : ["summarize", "summarize_findings"], refs);
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
  state.budgetStatuses.push(status);
  if (state.budgetStatus?.status === "blocked" && status.status === "blocked") {
    const currentEvidenceWeight = (state.budgetStatus.estimatedInputTokens ?? 0) + (state.budgetStatus.estimatedOutputTokens ?? 0);
    const nextEvidenceWeight = (status.estimatedInputTokens ?? 0) + (status.estimatedOutputTokens ?? 0);
    if (nextEvidenceWeight > currentEvidenceWeight) state.budgetStatus = status;
  } else if (status.status === "blocked" || state.budgetStatus?.status !== "blocked") {
    state.budgetStatus = status;
  }
  return status;
}

type ModelInvocationPlanForGate = {
  role: AgentRole;
  provider: string;
  model: string;
  prompt: string;
  maxOutputTokens: number;
};

type ModelInvocationBudgetScope = {
  reservations: BudgetReservation[];
  decisions: BudgetGateDecision[];
  preflight: ModelBudgetStatus;
};

function beginModelInvocationBudgetScope(input: {
  config: TomorrowEdgeConfig;
  state: AgentGraphState;
  ledger: EventLedger;
  invocation: ModelInvocationKind;
  phase: "planning" | "coding" | "judge";
  label: string;
  plans: ModelInvocationPlanForGate[];
  canFallback?: boolean;
}): ModelInvocationBudgetScope | undefined {
  const preflight = setBudgetStatus(input.state, preflightBudget(
    input.plans.map((plan) => ({ provider: plan.provider, prompt: plan.prompt, maxOutputTokens: plan.maxOutputTokens })),
    input.config.routing.max_cost_usd
  ));
  const reservations: BudgetReservation[] = [];
  const decisions: BudgetGateDecision[] = [];
  for (const plan of input.plans) {
    const estimatedCostUsd = estimateCostUsd(plan.provider, {
      inputTokens: estimateTextTokens(plan.prompt),
      outputTokens: plan.maxOutputTokens
    });
    const decision = evaluateModelCallInvocation({
      config: input.config,
      runtime: input.state.budgetRuntime,
      invocation: input.invocation,
      role: plan.role,
      assignment: {
        role: plan.role,
        provider: plan.provider,
        model: plan.model,
        reason: `${input.label} model invocation`
      },
      roleBudget: roleBudgetFor(input.config, plan.role),
      estimatedCostUsd: policyBudgetEstimate(estimatedCostUsd, input.state.orchestrationPolicy, plan.role),
      escalationSignals: policyEscalationSignals(input.state.orchestrationPolicy, input.state.plan?.riskLevel, [input.invocation, ...inferStrongAgentEscalationSignals(input.state.goal)]),
      canFallback: input.canFallback ?? false
    });
    decisions.push(decision);
    const providerReality = budgetProviderReality(plan.provider);
    input.ledger.append({
      type: "budget_decision",
      phase: decision.phase,
      role: plan.role,
      provider: plan.provider,
      model: plan.model,
      status: decision.action === "allow" ? "allowed" : "blocked",
      reason: `${decision.reason}${preflight.status === "blocked" ? ` Preflight estimate warning: ${preflight.reason}` : ""}`,
      invocationKind: input.invocation,
      budgetScope: decision.scope,
      maxCostUsd: roleBudgetFor(input.config, plan.role)?.maxCostPerCallUsd ?? input.config.strong_agents.max_cost_usd,
      estimatedCostUsd: decision.estimatedCostUsd,
      strongAgentCallsUsed: input.state.budgetRuntime.strongAgentCallsUsed,
      strongAgentCallsRemaining: decision.remainingCalls,
      realStrongAgentCallsUsed: input.state.budgetRuntime.realStrongAgentCallsUsed,
      simulatedStrongAgentCallsUsed: input.state.budgetRuntime.simulatedStrongAgentCallsUsed,
      realProvider: providerReality.realProvider,
      simulated: providerReality.simulated
    });
    if (decision.action !== "allow") {
      input.state.budgetRuntime.blockedRoles[plan.role] = decision.reason;
      releaseModelInvocationBudgetScope(input.state, reservations, decision.reason);
      input.ledger.append({
        type: "autonomy_limit_reached",
        phase: input.phase,
        role: plan.role,
        status: "blocked_by_budget",
        reason: `${input.label} blocked by unified budget gate: ${decision.reason}`
      });
      return undefined;
    }
    reservations.push(reserveRoleCall(input.state.budgetRuntime, decision));
  }
  return { reservations, decisions, preflight };
}

function beginGovernanceModelInvocation(runtime: OfflineGraphRuntime, state: AgentGraphState, input: {
  invocation: ModelInvocationKind;
  label: string;
  prompt: string;
  maxOutputTokens: number;
  localOnly: boolean;
}): ModelInvocationBudgetScope | undefined {
  if (!runtime.access.cloudAllowed) {
    runtime.ledger.append({
      type: "autonomy_limit_reached",
      phase: "planning",
      role: "planner",
      status: "blocked_by_access_mode",
      reason: `${input.label} blocked by access mode: ${runtime.access.mode}.`
    });
    return undefined;
  }
  const assignment = input.localOnly
    ? { role: "planner" as const, provider: "mock", model: "mock-balanced", reason: `${input.label} local mock invocation` }
    : runtime.router.assignmentFor("planner");
  return beginModelInvocationBudgetScope({
    config: runtime.config,
    state,
    ledger: runtime.ledger,
    invocation: input.invocation,
    phase: "planning",
    label: input.label,
    plans: [{
      role: "planner",
      provider: assignment.provider,
      model: assignment.model,
      prompt: input.prompt,
      maxOutputTokens: input.maxOutputTokens
    }]
  });
}

function commitModelInvocationBudgetScope(state: AgentGraphState, scope: ModelInvocationBudgetScope, notes?: ModelNote[]): void {
  const successful = !notes || notes.some((note) => !note.error);
  if (!successful) {
    releaseModelInvocationBudgetScope(state, scope.reservations, "model invocation returned only error notes");
    return;
  }
  for (const reservation of scope.reservations) commitRoleCall(state.budgetRuntime, reservation);
}

function releaseModelInvocationBudgetScope(state: AgentGraphState, reservations: BudgetReservation[], reason: string): void {
  for (const reservation of reservations) releaseRoleCall(state.budgetRuntime, reservation, reason);
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

function budgetProviderReality(provider: string): { realProvider: boolean; simulated: boolean } {
  const normalized = provider.toLowerCase();
  const simulated = normalized === "mock"
    || normalized === "fixture"
    || normalized === "local_tool"
    || normalized.startsWith("fixture:")
    || normalized.startsWith("mock:");
  return { realProvider: !simulated, simulated };
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
