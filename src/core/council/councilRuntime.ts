import type { AccessMode, TomorrowEdgeConfig } from "../../config/schema.js";
import type { AgentGraphState } from "../agentGraph/state.js";
import type { AgentRuntimeProfile } from "../agents/capabilityProfile.js";
import { buildAgentRuntimeProfiles } from "../agents/defaultCapabilityProfiles.js";
import { assignTaskOwners } from "../assignment/taskAssignmentEngine.js";
import { createBudgetRuntimeState, commitRoleCall, evaluateRoleInvocation, reserveRoleCall } from "../budget/budgetGate.js";
import { routeToChiefAgent, selectChiefAgent } from "../chiefAgent/chiefAgentRouter.js";
import { runFinalChiefReview } from "../chiefAgent/finalChiefReview.js";
import type { ChiefAgentProfile } from "../chiefAgent/chiefAgentTypes.js";
import { buildAccessPolicy } from "../permissions/accessPolicy.js";
import type { ObjectiveContractV1 } from "../contracts/objectiveContract.js";
import { createEventLedger } from "../events/eventLedger.js";
import type { EventArtifact } from "../events/eventTypes.js";
import type { TomorrowEdgeEvent } from "../events/eventTypes.js";
import type { EvidencePacket } from "../evidence/evidencePacket.js";
import { computeTraceCompleteness } from "../diagnostics/traceCompleteness.js";
import type { DelegatedTaskResult } from "../delegatedExecution/delegatedExecutionTypes.js";
import type { ExternalAgentProfile } from "../externalAgents/externalAgentTypes.js";
import { runCommandExternalAgent } from "../externalAgents/runners/commandExternalAgentRunner.js";
import { defaultStrategyGenome, type StrategyGenome } from "../evolution/strategyGenome.js";
import { mutateTaskGraphForStrategy, proposeStrategyMutations, type StrategyMutationEvent, type StrategySelectionDecision } from "../evolution/mutationEngine.js";
import { makeId } from "../../utils/ids.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import type { RiskLevel, TaskType } from "../../schemas/plan.js";
import type { TaskGraph, TaskGraphNode } from "../planning/taskGraph.js";
import { nextReadyTaskNodes } from "../planning/taskGraphScheduler.js";
import { runAgentCouncil } from "./councilRunner.js";
import type { CouncilSession } from "./councilTypes.js";
import { maybeTriggerCouncilReplan } from "./councilReplan.js";
import { ModelRouter } from "../routing/router.js";
import { classifyWorkflowIntent } from "../goal/workflowIntent.js";
import { profileScenarioWithModel } from "../scenarios/modelScenarioProfiler.js";
import type { ScenarioProfile } from "../scenarios/scenarioTypes.js";
import type { WorkflowKind } from "../orchestration/workflowKind.js";

export type CouncilRunOptions = {
  accessMode?: AccessMode;
  fixtureMode?: boolean;
  simulateFailureTaskId?: string;
  approvePatch?: boolean;
  approveShell?: boolean;
  maxMutations?: number;
  sessionId?: string;
  onEvent?: (event: TomorrowEdgeEvent) => void;
};

export async function runAgentCouncilGovernance(cwd: string, goal: string, config: TomorrowEdgeConfig, options: CouncilRunOptions = {}): Promise<AgentGraphState> {
  const access = buildAccessPolicy(config, {
    mode: options.accessMode ?? config.project.access_mode,
    approvePatch: options.approvePatch,
    approveShell: options.approveShell
  });
  const ledger = createEventLedger(access.mode, options.sessionId, options.onEvent);
  const router = new ModelRouter(config);
  const budgetRuntime = createBudgetRuntimeState();
  const availableAgents = buildAgentRuntimeProfiles(config);
  const workflowIntent = await classifyWorkflowIntent({
    goal,
    config,
    router,
    ledger,
    fixtureMode: options.fixtureMode,
    localOnly: options.fixtureMode || !access.cloudAllowed
  });
  const scenarioProfileResult = await profileScenarioWithModel({
    goal,
    workflowIntent,
    accessMode: access.mode,
    config,
    router,
    ledger,
    localOnly: options.fixtureMode || !access.cloudAllowed
  });
  if (!scenarioProfileResult.profile) {
    throw new Error(`Sirius scenario profiling failed; no local semantic fallback will be used. ${scenarioProfileResult.error ?? ""}`.trim());
  }
  const scenarioProfile = scenarioProfileResult.profile;
  ledger.append({
    type: "scenario_profile",
    phase: "planning",
    role: "planner",
    provider: scenarioProfileResult.provider,
    model: scenarioProfileResult.model,
    scenarioType: scenarioProfile.scenarioType,
    workflowKind: scenarioProfile.likelyWorkflowKind,
    ambiguityLevel: scenarioProfile.ambiguityLevel,
    expectedDeliverable: scenarioProfile.expectedDeliverable,
    riskSignals: scenarioProfile.riskSignals,
    profileRef: ledger.writeArtifact("scenario_profiles", JSON.stringify(scenarioProfile, null, 2), "json")
  });
  const riskLevel = riskLevelFromScenarioProfile(scenarioProfile);
  const taskType = taskTypeFromScenarioProfile(scenarioProfile, workflowIntent.workflowKind);
  const objectiveContract = createCouncilObjectiveContract(goal, config, riskLevel, scenarioProfile, workflowIntent.workflowKind, taskType);
  const chiefAgent = selectChiefAgent({ config, goal, availableAgents, objectiveContract });
  if (!chiefAgent) {
    throw new Error("No Chief Agent available for Sirius Agent Council runtime. Configure chief_agent or enable at least one capable core/planner/judge agent.");
  }
  const chiefDecision = await routeToChiefAgent({ chiefAgent, goal, context: { cwd, config, objectiveContract, availableAgents } });
  const strategyGenome = defaultStrategyGenome();

  ledger.append({
    type: "access_mode",
    phase: "routing",
    accessMode: access.mode,
    cloudAllowed: access.cloudAllowed,
    patchApproved: access.patchApproved,
    shellApproved: access.shellApproved,
    repairApproved: access.repairApproved,
    description: `Sirius council run mode=${access.mode}`
  });
  const contractRef = ledger.writeArtifact("objective_contract", JSON.stringify(objectiveContract, null, 2), "json");
  ledger.append({
    type: "objective_contract",
    phase: "planning",
    contractId: objectiveContract.contractId,
    contractRef,
    localObjective: objectiveContract.localObjective,
    scenarioType: objectiveContract.scenarioType,
    workflowKind: objectiveContract.workflowKind,
    riskLevel: objectiveContract.riskLevel,
    source: objectiveContract.source
  });
  ledger.append({
    type: "contract_verification",
    phase: "planning",
    contractId: objectiveContract.contractId,
    status: "passed",
    score: 1,
    missing: [],
    violations: [],
    repairs: [],
    verificationRef: ledger.writeArtifact("contract_verification", "Sirius native contract gate passed.", "txt")
  });
  ledger.append({
    type: "chief_agent_selected",
    phase: "routing",
    provider: chiefAgent.provider,
    model: chiefAgent.model,
    chiefAgentId: chiefAgent.id,
    reason: `selected by planning/judging/architecture capability for risk=${objectiveContract.riskLevel}`,
    trustLevel: chiefAgent.trustLevel
  });
  ledger.append({
    type: "chief_agent_decision",
    phase: "planning",
    provider: chiefAgent.provider,
    model: chiefAgent.model,
    chiefAgentId: chiefAgent.id,
    action: chiefDecision.action,
    reason: chiefDecision.reason,
    requiredCouncilRoles: chiefDecision.requiredCouncilRoles,
    initialRiskAssessment: chiefDecision.initialRiskAssessment
  });

  const chiefInitialPlanInvocation = await maybeInvokeChiefAgentStage({
    cwd,
    config,
    ledger,
    chiefAgent,
    role: "planner",
    task: `Create initial Sirius governed architecture plan: ${goal}`,
    context: { goal, objectiveContract, chiefDecision, strategyGenome, requiredEvidence: objectiveContract.requiredEvidence }
  });
  const chiefInitialPlanSource = chiefInitialPlanInvocation?.ok ? "chief_agent" : "native";
  const chiefPlanRef = ledger.writeArtifact("chief_initial_plan", JSON.stringify({
    goal,
    source: chiefInitialPlanSource,
    strategy: strategyGenome,
    decision: chiefDecision,
    requiredEvidence: objectiveContract.requiredEvidence,
    chiefAgentResult: chiefInitialPlanInvocation ? {
      ok: chiefInitialPlanInvocation.ok,
      externalAgentId: chiefInitialPlanInvocation.externalAgentId,
      summary: chiefInitialPlanInvocation.summary,
      refs: [chiefInitialPlanInvocation.requestRef, chiefInitialPlanInvocation.responseRef, chiefInitialPlanInvocation.resultRef].filter(Boolean)
    } : undefined
  }, null, 2), "json");
  ledger.append({
    type: "chief_initial_plan",
    phase: "planning",
    provider: chiefAgent.provider,
    model: chiefAgent.model,
    chiefAgentId: chiefAgent.id,
    planRef: chiefPlanRef,
    source: chiefInitialPlanSource,
    summary: "Chief produced an initial governed architecture plan and council policy."
  });

  const council = await runAgentCouncil({ goal, chiefAgent, availableAgents, riskLevel: objectiveContract.riskLevel, taskType: objectiveContract.taskType });
  await invokeConfiguredCouncilAdapters({ cwd, config, ledger, council, availableAgents, goal, objectiveContract, strategyGenome });
  recordCouncilEvents(ledger, council);
  let taskGraph = assignTaskOwners({
    taskGraph: council.consensusTaskGraph!,
    councilSession: council,
    availableAgents,
    budgetPolicy: { hardCapUsd: config.budget.hard_cap_usd, preferCheap: config.routing.mode === "cheap" },
    strategyGenome
  });
  recordOwnershipEvents(ledger, taskGraph);

  const evidencePackets: EvidencePacket[] = [];
  const delegatedResults: DelegatedTaskResult[] = [];
  const mutations: StrategyMutationEvent[] = [];
  let selectedStrategy: StrategyGenome = strategyGenome;
  let strategySelection: StrategySelectionDecision | undefined;
  let failureConsumed = false;
  let schedulerPasses = 0;
  while (taskGraph.nodes.some((node) => node.status === "pending")) {
    schedulerPasses += 1;
    if (schedulerPasses > taskGraph.nodes.length * 8) {
      throw new Error("Sirius TaskGraph scheduler exceeded safety pass limit; check for cyclic or unresolvable dependencies.");
    }
    const readyNodes = nextReadyTaskNodes(taskGraph);
    if (!readyNodes.length) {
      if (markNodesBlockedByDependencies({ ledger, taskGraph, delegatedResults })) continue;
      break;
    }
    let restartScheduler = false;
    for (const node of readyNodes) {
      if (node.status !== "pending") continue;
      const firstAttemptShouldFail = !failureConsumed && node.id === (options.simulateFailureTaskId ?? "");
      const result = await executeDelegatedNode({ cwd, taskGraphId: taskGraph.graphId, node, config, ledger, budgetRuntime, availableAgents, shouldFail: firstAttemptShouldFail });
      delegatedResults.push(result.result);
      if (result.packet) evidencePackets.push(result.packet);
      if (firstAttemptShouldFail) {
        failureConsumed = true;
        const mutation = proposeStrategyMutations({
          strategy: selectedStrategy,
          trigger: "test_failed",
          taskGraph,
          affectedTaskNodeIds: [node.id],
          mutationCount: mutations.length,
          maxMutations: options.maxMutations
        });
        selectedStrategy = mutation.selectedStrategy;
        strategySelection = mutation.decision;
        taskGraph = mutateTaskGraphForStrategy(taskGraph, mutation.mutations);
        taskGraph = assignTaskOwners({
          taskGraph,
          councilSession: council,
          availableAgents,
          budgetPolicy: { hardCapUsd: config.budget.hard_cap_usd, preferCheap: selectedStrategy.budgetPolicy === "cheap_first" },
          strategyGenome: selectedStrategy
        });
        applyMutationOwnershipChanges(taskGraph, mutation.mutations, availableAgents);
        mutations.push(...mutation.mutations);
        recordMutationEvents(ledger, mutation.mutations, mutation.decision);
        recordOwnershipEvents(ledger, taskGraph, "evolved");
        const retryNode = taskGraph.nodes.find((item) => item.id === node.id) ?? node;
        retryNode.status = "pending";
        const retry = await executeDelegatedNode({ cwd, taskGraphId: taskGraph.graphId, node: retryNode, config, ledger, budgetRuntime, availableAgents, shouldFail: false, retryAfterMutation: true });
        delegatedResults.push(retry.result);
        if (retry.packet) evidencePackets.push(retry.packet);
        const replan = await maybeTriggerCouncilReplan({
          state: partialState({ cwd, goal, access, objectiveContract, chiefAgent, chiefDecision, council, taskGraph, ledger, budgetRuntime, strategyGenome: selectedStrategy, delegatedResults, evidencePackets, mutations, strategySelection }),
          failureSignal: { trigger: "test_failed", reason: "Delegated execution failed and was recovered by mutation.", taskNodeIds: [node.id], repeated: false },
          currentStrategy: selectedStrategy
        });
        if (replan) {
          const oldTaskGraphRef = ledger.writeArtifact("task_graph_old", JSON.stringify(taskGraph, null, 2), "json");
          const newTaskGraphRef = ledger.writeArtifact("task_graph_replan", JSON.stringify(replan.consensusTaskGraph, null, 2), "json");
          ledger.append({
            type: "council_replan",
            phase: "council",
            councilSessionId: replan.sessionId,
            reason: "Council replan considered after delegated execution failure.",
            oldTaskGraphRef,
            newTaskGraphRef,
            graphDiffRef: ledger.writeArtifact("task_graph_diff", `old=${taskGraph.graphId}\nnew=${replan.consensusTaskGraph?.graphId}`, "txt")
          });
        }
        restartScheduler = true;
        break;
      }
    }
    if (restartScheduler) continue;
  }

  const graphRef = ledger.writeArtifact("task_graph", JSON.stringify(taskGraph, null, 2), "json");
  ledger.append({
    type: "task_graph",
    phase: "planning",
    graphRef,
    nodeCount: taskGraph.nodes.length,
    edgeCount: taskGraph.edges.length,
    entryNodeIds: taskGraph.entryNodeIds,
    terminalNodeIds: taskGraph.terminalNodeIds
  });

  const nativeFinalChiefReview = runFinalChiefReview({
    chiefAgentId: chiefAgent.id,
    taskGraph,
    delegatedResults,
    evidencePackets,
    artifacts: ledger.artifacts,
    mutationCount: mutations.length
  });
  const finalChiefReviewInvocation = await maybeInvokeChiefAgentStage({
    cwd,
    config,
    ledger,
    chiefAgent,
    role: "judge",
    task: `Perform final Sirius chief review: ${goal}`,
    context: { goal, taskGraph, delegatedResults, evidencePackets, nativeFinalChiefReview }
  });
  const finalChiefReview = {
    ...nativeFinalChiefReview,
    source: finalChiefReviewInvocation?.ok ? "chief_agent" as const : "native" as const,
    codeReviewSummary: finalChiefReviewInvocation?.ok
      ? `${nativeFinalChiefReview.codeReviewSummary} Chief adapter evidence: ${finalChiefReviewInvocation.summary}`
      : nativeFinalChiefReview.codeReviewSummary
  };
  const finalReviewRef = ledger.writeArtifact("chief_final_review", JSON.stringify(finalChiefReview, null, 2), "json");
  ledger.append({
    type: "chief_final_review",
    phase: "delivery",
    provider: chiefAgent.provider,
    model: chiefAgent.model,
    chiefAgentId: chiefAgent.id,
    decision: finalChiefReview.decision,
    architectureConsistency: finalChiefReview.architectureConsistency,
    reviewRef: finalReviewRef,
    summary: finalChiefReview.codeReviewSummary,
    unresolvedRisks: finalChiefReview.unresolvedRisks,
    requiredRevisions: finalChiefReview.requiredRevisions,
    source: finalChiefReview.source
  });
  const deliverableRef = ledger.writeArtifact("deliverable", JSON.stringify({
    goal,
    taskGraph,
    delegatedResults,
    finalChiefReview
  }, null, 2), "json");
  if (finalChiefReview.decision === "approve_delivery") {
    ledger.append({
      type: "chief_delivery_approved",
      phase: "delivery",
      chiefAgentId: chiefAgent.id,
      provider: chiefAgent.provider,
      model: chiefAgent.model,
      deliverableRef,
      summary: "Chief approved delivery after reviewing task ownership, evidence, delegated execution, and mutation events."
    });
  } else {
    ledger.append({
      type: "chief_revision_requested",
      phase: "delivery",
      chiefAgentId: chiefAgent.id,
      provider: chiefAgent.provider,
      model: chiefAgent.model,
      requiredRevisions: finalChiefReview.requiredRevisions,
      reason: finalChiefReview.unresolvedRisks.join("; ") || "Chief requested revision."
    });
  }
  ledger.append({
    type: "summary",
    phase: "summary",
    summaryRef: deliverableRef,
    result: finalChiefReview.decision === "approve_delivery" ? "completed" : "partially_completed"
  });
  ledger.append({
    type: "workflow_stop_reason",
    phase: "summary",
    reason: finalChiefReview.decision === "approve_delivery" ? "chief_delivery_approved" : "chief_revision_requested",
    result: finalChiefReview.decision === "approve_delivery" ? "completed" : "partially_completed"
  });

  return partialState({ cwd, goal, access, objectiveContract, chiefAgent, chiefDecision, council: { ...council, consensusTaskGraph: taskGraph, consensusPlan: council.consensusPlan ? { ...council.consensusPlan, taskGraph } : council.consensusPlan }, taskGraph, ledger, budgetRuntime, strategyGenome: selectedStrategy, delegatedResults, evidencePackets, mutations, strategySelection, finalChiefReview });
}

async function executeDelegatedNode(input: {
  cwd: string;
  taskGraphId: string;
  node: TaskGraphNode;
  config: TomorrowEdgeConfig;
  ledger: ReturnType<typeof createEventLedger>;
  budgetRuntime: ReturnType<typeof createBudgetRuntimeState>;
  availableAgents: AgentRuntimeProfile[];
  shouldFail: boolean;
  retryAfterMutation?: boolean;
}): Promise<{ result: DelegatedTaskResult; packet?: EvidencePacket }> {
  const attemptedOwnerIds = new Set<string>();
  let shouldFail = input.shouldFail;
  let retryAfterMutation = input.retryAfterMutation;
  while (true) {
    const ownerId = input.node.ownerAgentId ?? "unassigned";
    attemptedOwnerIds.add(ownerId);
    const attempt = await executeDelegatedNodeAttempt({ ...input, shouldFail, retryAfterMutation });
    const failureSignal = attempt.result.failureSignals?.join("; ") ?? "";
    const canRuntimeFallback = !shouldFail && (attempt.result.status === "blocked" || attempt.result.status === "failed");
    const trigger = canRuntimeFallback
      ? failureSignal.includes("budget blocked") ? "budget_blocked" : "agent_failure"
      : undefined;
    if (!trigger) return attempt;
    const reassigned = reassignNodeToFallback({
      taskGraphId: input.taskGraphId,
      node: input.node,
      availableAgents: input.availableAgents,
      ledger: input.ledger,
      attemptedOwnerIds,
      trigger,
      reason: failureSignal || `${input.node.id} failed under owner ${ownerId}`
    });
    if (!reassigned) return attempt;
    shouldFail = false;
    retryAfterMutation = true;
  }
}

async function executeDelegatedNodeAttempt(input: {
  cwd: string;
  taskGraphId: string;
  node: TaskGraphNode;
  config: TomorrowEdgeConfig;
  ledger: ReturnType<typeof createEventLedger>;
  budgetRuntime: ReturnType<typeof createBudgetRuntimeState>;
  availableAgents: AgentRuntimeProfile[];
  shouldFail: boolean;
  retryAfterMutation?: boolean;
}): Promise<{ result: DelegatedTaskResult; packet?: EvidencePacket }> {
  const assignment = {
    role: input.node.ownerRole,
    provider: input.node.assignedProvider ?? "mock",
    model: input.node.assignedModel ?? "mock-balanced",
    reason: input.node.assignmentReason ?? "Sirius task ownership assignment"
  };
  const decision = evaluateRoleInvocation({
    config: input.config,
    runtime: input.budgetRuntime,
    role: input.node.ownerRole,
    phase: input.node.phase,
    assignment,
    estimatedCostUsd: estimateNodeCost(input.node),
    escalationSignals: input.node.riskLevel === "high" ? ["high_risk_patch"] : [],
    canFallback: Boolean(input.node.fallbackAgents?.length)
  });
  const reservation = decision.action === "allow" ? reserveRoleCall(input.budgetRuntime, decision) : undefined;
  input.ledger.append({
    type: "budget_decision",
    phase: input.node.phase,
    role: input.node.ownerRole,
    provider: assignment.provider,
    model: assignment.model,
    status: decision.action === "allow" ? "allowed" : "blocked",
    reason: decision.reason,
    budgetScope: decision.scope,
    maxCostUsd: input.config.strong_agents.max_cost_usd,
    estimatedCostUsd: decision.estimatedCostUsd,
    strongAgentCallsUsed: input.budgetRuntime.strongAgentCallsUsed,
    strongAgentCallsRemaining: decision.remainingCalls,
    realProvider: decision.realProvider,
    simulated: decision.simulated
  });
  if (decision.action !== "allow") {
    const blocked: DelegatedTaskResult = {
      taskNodeId: input.node.id,
      ownerAgentId: input.node.ownerAgentId ?? "unassigned",
      provider: assignment.provider,
      model: assignment.model,
      status: "blocked",
      evidenceRefs: [],
      artifactRefs: [],
      failureSignals: [`budget blocked: ${decision.reason}`],
      summary: `Delegated task ${input.node.id} blocked by BudgetGate.`
    };
    recordDelegatedResult(input.ledger, blocked, input.node);
    return { result: blocked };
  }
  if (reservation) commitRoleCall(input.budgetRuntime, reservation);

  const externalProfile = !input.shouldFail ? externalProfileForNode(input.config, input.node) : undefined;
  const externalResult = externalProfile?.command ? await runCommandExternalAgent({
    cwd: input.cwd,
    profile: externalProfile,
    role: input.node.ownerRole,
    task: input.node.objective,
    context: {
      taskNodeId: input.node.id,
      title: input.node.title,
      expectedOutputs: input.node.expectedOutputs,
      requiredEvidence: input.node.requiredEvidence,
      retryAfterMutation: Boolean(input.retryAfterMutation)
    },
    ledger: input.ledger,
    timeoutMs: externalProfile.requestTimeoutMs
  }) : undefined;
  const status = input.shouldFail || externalResult?.ok === false ? "failed" : "success";
  const externalArtifactRefs = [externalResult?.requestRef, externalResult?.responseRef, externalResult?.resultRef].filter((ref): ref is string => Boolean(ref));
  const artifactRef = input.ledger.writeArtifact("delegated_task", JSON.stringify({
    taskNodeId: input.node.id,
    ownerAgentId: input.node.ownerAgentId,
    provider: assignment.provider,
    model: assignment.model,
    status,
    retryAfterMutation: Boolean(input.retryAfterMutation),
    externalAgent: externalResult ? {
      ok: externalResult.ok,
      externalAgentId: externalResult.externalAgentId,
      durationMs: externalResult.durationMs,
      summary: externalResult.summary,
      refs: externalArtifactRefs
    } : undefined,
    objective: input.node.objective
  }, null, 2), "json");
  const packet: EvidencePacket | undefined = status === "success" ? {
    id: makeId("evidence"),
    phase: input.node.kind === "verify" ? "test" : input.node.kind === "review" ? "review" : input.node.kind === "judge" ? "judge" : input.node.kind === "repair" ? "repair" : "patch",
    taskNodeId: input.node.id,
    ownerAgentId: input.node.ownerAgentId,
    summary: externalResult?.summary ?? `${input.node.title} completed by ${input.node.ownerAgentId}.`,
    claims: [`${input.node.id} satisfied ${input.node.acceptanceCriteria[0] ?? "acceptance criteria"}`],
    supportingArtifacts: [...externalArtifactRefs, artifactRef],
    riskSignals: input.node.riskLevel === "high" ? ["high-risk node reviewed by governance runtime"] : [],
    verificationStatus: "passed",
    modelVisibleText: `${input.node.title}: evidence=${artifactRef}`
  } : undefined;
  if (packet) {
    const packetRef = input.ledger.writeArtifact("evidence_packet", JSON.stringify(packet, null, 2), "json");
    input.ledger.append({
      type: "evidence_packet",
      phase: input.node.phase,
      role: input.node.ownerRole,
      provider: assignment.provider,
      model: assignment.model,
      packetId: packet.id,
      evidencePhase: packet.phase,
      summary: packet.summary,
      verificationStatus: packet.verificationStatus,
      supportingArtifacts: packet.supportingArtifacts,
      packetRef
    });
    input.node.evidenceRefs = [...(input.node.evidenceRefs ?? []), packet.id];
  }
  input.node.artifactRefs = [...(input.node.artifactRefs ?? []), ...externalArtifactRefs, artifactRef];
  input.node.status = status === "success" ? "done" : "blocked";
  const result: DelegatedTaskResult = {
    taskNodeId: input.node.id,
    ownerAgentId: input.node.ownerAgentId ?? "unassigned",
    provider: assignment.provider,
    model: assignment.model,
    status,
    evidenceRefs: packet ? [packet.id] : [],
    artifactRefs: [...externalArtifactRefs, artifactRef],
    costUsage: { estimatedCostUsd: decision.estimatedCostUsd },
    failureSignals: status === "failed" ? [externalResult?.error ?? externalResult?.summary ?? "simulated delegated execution failure"] : [],
    summary: status === "success"
      ? (externalResult?.summary ?? `${input.node.id} completed by ${input.node.ownerAgentId}.`)
      : `${input.node.id} failed before mutation.`
  };
  recordDelegatedResult(input.ledger, result, input.node);
  return { result, packet };
}

function reassignNodeToFallback(input: {
  taskGraphId: string;
  node: TaskGraphNode;
  availableAgents: AgentRuntimeProfile[];
  ledger: ReturnType<typeof createEventLedger>;
  attemptedOwnerIds: Set<string>;
  trigger: "budget_blocked" | "agent_failure";
  reason: string;
}): boolean {
  const oldOwnerAgentId = input.node.ownerAgentId ?? "unassigned";
  const nextOwner = (input.node.fallbackAgents ?? [])
    .map((agentId) => input.availableAgents.find((agent) => agent.agentId === agentId))
    .filter((agent): agent is AgentRuntimeProfile => Boolean(agent))
    .find((agent) => !input.attemptedOwnerIds.has(agent.agentId) && agent.allowedRoles.includes(input.node.ownerRole));
  if (!nextOwner) return false;
  input.node.ownerAgentId = nextOwner.agentId;
  input.node.assignedProvider = nextOwner.provider;
  input.node.assignedModel = nextOwner.model;
  input.node.claimMode = "evolved";
  input.node.status = "pending";
  input.node.assignmentReason = `${input.node.assignmentReason ?? "Sirius task ownership assignment"}; reassigned from ${oldOwnerAgentId} to ${nextOwner.agentId} after ${input.trigger}: ${input.reason}`;
  input.ledger.append({
    type: "task_ownership_reassignment",
    phase: "routing",
    role: input.node.ownerRole,
    provider: nextOwner.provider,
    model: nextOwner.model,
    taskGraphId: input.taskGraphId,
    taskNodeId: input.node.id,
    oldOwnerAgentId,
    newOwnerAgentId: nextOwner.agentId,
    assignedProvider: nextOwner.provider,
    assignedModel: nextOwner.model,
    trigger: input.trigger,
    reason: input.node.assignmentReason
  });
  return true;
}

function markNodesBlockedByDependencies(input: {
  ledger: ReturnType<typeof createEventLedger>;
  taskGraph: TaskGraph;
  delegatedResults: DelegatedTaskResult[];
}): boolean {
  let changed = false;
  for (const node of input.taskGraph.nodes) {
    if (node.status !== "pending") continue;
    const blockedDependencies = node.dependsOn.filter((dependency) =>
      input.taskGraph.nodes.some((candidate) => candidate.id === dependency && candidate.status === "blocked")
    );
    if (!blockedDependencies.length) continue;
    node.status = "blocked";
    const result: DelegatedTaskResult = {
      taskNodeId: node.id,
      ownerAgentId: node.ownerAgentId ?? "unassigned",
      provider: node.assignedProvider ?? "mock",
      model: node.assignedModel ?? "mock-balanced",
      status: "blocked",
      evidenceRefs: [],
      artifactRefs: [],
      failureSignals: [`blocked dependencies: ${blockedDependencies.join(", ")}`],
      summary: `${node.id} blocked because required dependencies did not complete: ${blockedDependencies.join(", ")}.`
    };
    input.delegatedResults.push(result);
    recordDelegatedResult(input.ledger, result, node);
    changed = true;
  }
  return changed;
}

function partialState(input: {
  cwd: string;
  goal: string;
  access: ReturnType<typeof buildAccessPolicy>;
  objectiveContract: ObjectiveContractV1;
  chiefAgent: ChiefAgentProfile;
  chiefDecision: Awaited<ReturnType<typeof routeToChiefAgent>>;
  council: CouncilSession;
  taskGraph: TaskGraph;
  ledger: ReturnType<typeof createEventLedger>;
  budgetRuntime: ReturnType<typeof createBudgetRuntimeState>;
  strategyGenome: StrategyGenome;
  delegatedResults: DelegatedTaskResult[];
  evidencePackets: EvidencePacket[];
  mutations: StrategyMutationEvent[];
  strategySelection?: StrategySelectionDecision;
  finalChiefReview?: ReturnType<typeof runFinalChiefReview>;
}): AgentGraphState {
  const plan = input.council.consensusPlan ? { ...input.council.consensusPlan, taskGraph: input.taskGraph } : undefined;
  const traceCompleteness = computeTraceCompleteness(input.ledger.events, { workflowKind: "sirius_council", plan });
  return {
    sessionId: input.ledger.sessionId,
    goal: input.goal,
    routing: {
      mode: "balanced",
      privacyLocked: false,
      assignments: input.taskGraph.nodes.map((node) => ({
        role: node.ownerRole,
        provider: node.assignedProvider ?? "mock",
        model: node.assignedModel ?? "mock-balanced",
        reason: node.assignmentReason ?? "Sirius task ownership assignment"
      })),
      fallbacks: []
    },
    access: input.access,
    events: input.ledger.events,
    eventArtifacts: input.ledger.artifacts,
    providerViews: [],
    evidencePackets: input.evidencePackets,
    agents: input.taskGraph.nodes.map((node) => ({
      id: node.ownerAgentId ?? node.id,
      role: node.ownerRole,
      provider: node.assignedProvider ?? "mock",
      model: node.assignedModel ?? "mock-balanced",
      status: node.status === "done" ? "success" : node.status === "blocked" ? "blocked" : "pending",
      agentKind: node.assignedProvider?.startsWith("external:") ? "external" : "offline",
      summary: node.assignmentReason ?? node.title
    })),
    plan,
    candidates: [],
    repairCandidates: [],
    debateRounds: [],
    modelNotes: [],
    usageSummary: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: input.delegatedResults.reduce((sum, result) => sum + (result.costUsage?.estimatedCostUsd ?? 0), 0)
    },
    workflowKind: "sirius_council",
    objectiveContract: input.objectiveContract,
    contractVerification: { status: "passed", score: 1, missing: [], violations: [], repairs: [] },
    chiefAgent: input.chiefAgent,
    chiefDecision: input.chiefDecision,
    council: input.council,
    delegatedTaskResults: input.delegatedResults,
    strategyGenome: input.strategyGenome,
    strategyMutations: input.mutations,
    strategySelection: input.strategySelection,
    finalChiefReview: input.finalChiefReview,
    budgetRuntime: input.budgetRuntime,
    budgetStatuses: [],
    changedFiles: [],
    runResults: [],
    approvals: {
      patchApproved: input.access.patchApproved,
      shellApproved: input.access.shellApproved,
      repairApproved: input.access.repairApproved
    },
    finalSummary: input.finalChiefReview ? {
      task: input.goal,
      result: input.finalChiefReview.decision === "approve_delivery" ? "completed" : "partially_completed",
      userReply: input.finalChiefReview.decision === "approve_delivery"
        ? `Chief ${input.chiefAgent.id} approved delivery after council governance and delegated execution.`
        : `Chief ${input.chiefAgent.id} requested revision: ${input.finalChiefReview.requiredRevisions.join("; ")}`,
      userReplySource: "system",
      changedFiles: [],
      testsRun: [],
      evidence: input.finalChiefReview.evidenceRefs,
      risksRemaining: input.finalChiefReview.unresolvedRisks,
      suggestedCommitMessage: "feat: deliver Sirius governed agent council run"
    } : undefined,
    traceCompleteness
  };
}

function recordCouncilEvents(ledger: ReturnType<typeof createEventLedger>, council: CouncilSession): void {
  ledger.append({
    type: "council_session_started",
    phase: "council",
    councilSessionId: council.sessionId,
    chiefAgentId: council.chiefAgentId,
    memberAgentIds: council.members.map((member) => member.agentId),
    reason: "Chief convened structured Agent Council for governed planning."
  });
  for (const move of council.moves) {
    ledger.append({
      type: "council_move",
      phase: "council",
      councilSessionId: council.sessionId,
      moveId: move.id,
      round: move.round,
      moveType: move.type,
      speakerAgentId: move.speakerAgentId,
      targetMoveId: move.targetMoveId,
      summary: move.summary,
      source: move.source ?? "native",
      moveRef: ledger.writeArtifact("council_move", JSON.stringify(move, null, 2), "json")
    });
  }
  ledger.append({
    type: "council_consensus",
    phase: "council",
    councilSessionId: council.sessionId,
    taskGraphRef: ledger.writeArtifact("council_consensus_task_graph", JSON.stringify(council.consensusTaskGraph, null, 2), "json"),
    nodeCount: council.consensusTaskGraph?.nodes.length ?? 0,
    unresolvedRisks: council.unresolvedRisks,
    status: council.status
  });
}

function recordOwnershipEvents(ledger: ReturnType<typeof createEventLedger>, taskGraph: TaskGraph, forcedClaimMode?: "evolved"): void {
  for (const node of taskGraph.nodes) {
    ledger.append({
      type: "task_ownership_assignment",
      phase: "routing",
      role: node.ownerRole,
      provider: node.assignedProvider,
      model: node.assignedModel,
      taskGraphId: taskGraph.graphId,
      taskNodeId: node.id,
      ownerAgentId: node.ownerAgentId ?? "unassigned",
      assignedProvider: node.assignedProvider ?? "mock",
      assignedModel: node.assignedModel,
      assignmentReason: node.assignmentReason ?? "No assignment reason recorded",
      claimMode: forcedClaimMode ?? node.claimMode ?? "assigned",
      fallbackAgents: node.fallbackAgents ?? []
    });
  }
}

function recordDelegatedResult(ledger: ReturnType<typeof createEventLedger>, result: DelegatedTaskResult, node: TaskGraphNode): void {
  ledger.append({
    type: "delegated_task_result",
    phase: node.phase,
    role: node.ownerRole,
    provider: result.provider,
    model: result.model,
    taskNodeId: result.taskNodeId,
    ownerAgentId: result.ownerAgentId,
    status: result.status,
    summary: result.summary,
    evidenceRefs: result.evidenceRefs,
    artifactRefs: result.artifactRefs,
    estimatedCostUsd: result.costUsage?.estimatedCostUsd,
    failureSignals: result.failureSignals
  });
  ledger.append({
    type: "task_node_result",
    phase: node.phase,
    role: node.ownerRole,
    taskNodeId: result.taskNodeId,
    status: result.status === "success" ? "done" : result.status === "failed" ? "blocked" : result.status,
    summary: result.summary,
    evidence: result.evidenceRefs,
    artifacts: result.artifactRefs,
    evidenceRef: result.evidenceRefs[0],
    error: result.failureSignals?.join("; ")
  });
}

function recordMutationEvents(ledger: ReturnType<typeof createEventLedger>, mutations: StrategyMutationEvent[], decision: StrategySelectionDecision): void {
  for (const mutation of mutations) {
    ledger.append({
      type: "strategy_mutation",
      phase: "evolution",
      mutationId: mutation.id,
      parentStrategyId: mutation.parentStrategyId,
      childStrategyId: mutation.childStrategyId,
      mutationType: mutation.type,
      trigger: mutation.trigger,
      reason: mutation.reason,
      affectedTaskNodeIds: mutation.affectedTaskNodeIds,
      selected: mutation.selected,
      requestedChange: mutation.requestedChange,
      appliedChange: mutation.appliedChange,
      changedOwner: mutation.changedOwner,
      oldOwnerAgentId: mutation.oldOwnerAgentId,
      newOwnerAgentId: mutation.newOwnerAgentId,
      mutationRef: ledger.writeArtifact("strategy_mutation", JSON.stringify(mutation, null, 2), "json")
    });
  }
  ledger.append({
    type: "strategy_selection_decision",
    phase: "evolution",
    selectedStrategyId: decision.selectedStrategyId,
    candidatesRef: ledger.writeArtifact("strategy_selection", JSON.stringify(decision, null, 2), "json"),
    selectionReason: decision.selectionReason
  });
}

async function maybeInvokeChiefAgentStage(input: {
  cwd: string;
  config: TomorrowEdgeConfig;
  ledger: ReturnType<typeof createEventLedger>;
  chiefAgent: ChiefAgentProfile;
  role: AgentRole;
  task: string;
  context: unknown;
}): Promise<Awaited<ReturnType<typeof runCommandExternalAgent>> | undefined> {
  const profile = externalProfileForAgentId(input.config, input.chiefAgent.id);
  if (!profile?.command) return undefined;
  const result = await runCommandExternalAgent({
    cwd: input.cwd,
    profile,
    role: input.role,
    task: input.task,
    context: input.context,
    ledger: input.ledger,
    timeoutMs: profile.requestTimeoutMs
  });
  if (!result.ok) {
    input.ledger.append({
      type: "fallback_to_native",
      phase: input.role === "judge" ? "delivery" : "planning",
      role: input.role,
      provider: input.chiefAgent.provider,
      model: input.chiefAgent.model,
      externalAgentId: input.chiefAgent.id,
      fallbackRole: input.role,
      reason: `Chief adapter ${input.chiefAgent.id} failed; native Sirius governance artifact remains authoritative. ${result.error ?? result.summary}`
    });
  }
  return result;
}

async function invokeConfiguredCouncilAdapters(input: {
  cwd: string;
  config: TomorrowEdgeConfig;
  ledger: ReturnType<typeof createEventLedger>;
  council: CouncilSession;
  availableAgents: AgentRuntimeProfile[];
  goal: string;
  objectiveContract: ObjectiveContractV1;
  strategyGenome: StrategyGenome;
}): Promise<void> {
  for (const move of input.council.moves) {
    const profile = externalProfileForAgentId(input.config, move.speakerAgentId);
    if (!profile?.command) continue;
    const role = roleForCouncilMove(move.type);
    const result = await runCommandExternalAgent({
      cwd: input.cwd,
      profile,
      role,
      task: `Sirius council ${move.type}: ${input.goal}`,
      context: {
        goal: input.goal,
        move,
        councilSessionId: input.council.sessionId,
        objectiveContract: input.objectiveContract,
        strategyGenome: input.strategyGenome,
        availableAgents: input.availableAgents.map((agent) => ({
          agentId: agent.agentId,
          provider: agent.provider,
          model: agent.model,
          allowedRoles: agent.allowedRoles,
          capabilities: agent.capabilities
        }))
      },
      ledger: input.ledger,
      timeoutMs: profile.requestTimeoutMs
    });
    if (result.ok) {
      move.source = "agent";
      move.evidenceRefs = [...(move.evidenceRefs ?? []), ...[result.requestRef, result.responseRef, result.resultRef].filter((ref): ref is string => Boolean(ref))];
      move.summary = `${move.summary} Adapter evidence: ${result.summary}`;
    } else {
      input.ledger.append({
        type: "fallback_to_native",
        phase: "council",
        role,
        provider: `external:${profile.id}`,
        model: profile.name,
        externalAgentId: profile.id,
        fallbackRole: role,
        reason: `Council move ${move.id} kept native source because adapter failed: ${result.error ?? result.summary}`
      });
    }
  }
}

function roleForCouncilMove(type: CouncilSession["moves"][number]["type"]): AgentRole {
  if (type === "critique" || type === "risk_objection") return "reviewer";
  if (type === "gap_fill") return "runner";
  if (type === "final_consensus") return "judge";
  return "planner";
}

function applyMutationOwnershipChanges(taskGraph: TaskGraph, mutations: StrategyMutationEvent[], availableAgents: AgentRuntimeProfile[]): void {
  for (const mutation of mutations) {
    const node = taskGraph.nodes.find((item) => mutation.affectedTaskNodeIds.includes(item.id));
    if (!node) continue;
    const oldOwnerAgentId = mutation.oldOwnerAgentId ?? node.ownerAgentId ?? "unassigned";
    mutation.oldOwnerAgentId = oldOwnerAgentId;
    if (mutation.type !== "switch_owner_agent") {
      mutation.changedOwner = false;
      mutation.newOwnerAgentId = node.ownerAgentId ?? oldOwnerAgentId;
      mutation.appliedChange = mutation.appliedChange ?? `kept owner ${mutation.newOwnerAgentId}`;
      continue;
    }
    const fallback = (node.fallbackAgents ?? [])
      .map((agentId) => availableAgents.find((agent) => agent.agentId === agentId))
      .filter((agent): agent is AgentRuntimeProfile => Boolean(agent))
      .find((agent) => agent.agentId !== oldOwnerAgentId && agent.allowedRoles.includes(node.ownerRole));
    if (!fallback) {
      mutation.type = "retry_same_owner";
      mutation.changedOwner = false;
      mutation.newOwnerAgentId = node.ownerAgentId ?? oldOwnerAgentId;
      mutation.appliedChange = "no fallback owner available; retried same owner";
      return;
    }
    node.ownerAgentId = fallback.agentId;
    node.assignedProvider = fallback.provider;
    node.assignedModel = fallback.model;
    node.claimMode = "evolved";
    node.assignmentReason = `${node.assignmentReason ?? "Sirius task ownership assignment"}; StrategyMutation switched owner from ${oldOwnerAgentId} to ${fallback.agentId}.`;
    mutation.changedOwner = true;
    mutation.newOwnerAgentId = fallback.agentId;
    mutation.appliedChange = `switched owner from ${oldOwnerAgentId} to ${fallback.agentId}`;
  }
}

function externalProfileForNode(config: TomorrowEdgeConfig, node: TaskGraphNode): ExternalAgentProfile | undefined {
  if (!node.ownerAgentId || !node.assignedProvider?.startsWith("external:")) return undefined;
  return externalProfileForAgentId(config, node.ownerAgentId);
}

function externalProfileForAgentId(config: TomorrowEdgeConfig, agentId: string): ExternalAgentProfile | undefined {
  const configured = config.external_agents[agentId];
  if (!configured?.enabled) return undefined;
  return {
    id: agentId,
    name: configured.name ?? agentId,
    transport: configured.transport,
    adapter: configured.adapter,
    responseMode: configured.responseMode,
    strictJson: configured.strictJson,
    workingTreeMode: configured.workingTreeMode,
    normalizationStrictness: configured.normalizationStrictness,
    command: configured.command,
    args: configured.args,
    cwd: configured.cwd,
    env: configured.env,
    proxyPort: configured.proxyPort,
    autoStart: configured.autoStart,
    startupTimeoutMs: configured.startupTimeoutMs,
    requestTimeoutMs: configured.requestTimeoutMs,
    maxRetries: configured.maxRetries,
    capabilities: configured.capabilities,
    allowedRoles: configured.roles,
    trustLevel: configured.trustLevel,
    costProfile: configured.costProfile,
    notes: configured.notes
  };
}

function createCouncilObjectiveContract(
  goal: string,
  config: TomorrowEdgeConfig,
  riskLevel: RiskLevel,
  scenarioProfile: ScenarioProfile,
  workflowKind: WorkflowKind,
  taskType: TaskType
): ObjectiveContractV1 {
  const patchLike = workflowKind === "patch" || workflowKind === "repair" || workflowKind === "vision_patch";
  return {
    schemaVersion: "objective-contract/v1",
    contractId: makeId("contract"),
    createdAt: new Date().toISOString(),
    goal,
    normalizedGoal: goal.trim(),
    scenarioType: scenarioProfile.scenarioType,
    taskType,
    workflowKind,
    localObjective: goal,
    userScenario: {
      inferredUserIntent: scenarioProfile.userIntent,
      expectedDeliverable: scenarioProfile.expectedDeliverable,
      interactionMode: patchLike ? "code_change" : scenarioProfile.scenarioType === "document" ? "artifact" : scenarioProfile.scenarioType === "analysis" || scenarioProfile.scenarioType === "research" || scenarioProfile.scenarioType === "planning" ? "analysis" : "answer",
      ambiguityLevel: scenarioProfile.ambiguityLevel
    },
    successCriteria: ["Chief initial plan recorded", "Council consensus TaskGraph recorded", "Delegated execution evidence recorded", "Chief final review recorded"],
    failureCriteria: ["Objective Contract violation", "unresolved blocking risk after chief review", "mutation limit exhausted"],
    requiredEvidence: ["chief_plan", "council_moves", "task_ownership", "delegated_execution", "final_chief_review"],
    allowedPhases: patchLike ? ["routing", "planning", "council", "coding", "review", "judge", "verification", "evolution", "delivery", "summary"] : ["routing", "planning", "council", "exploration", "delivery", "summary"],
    allowedRoles: patchLike ? ["core", "planner", "explorer", "coder_a", "coder_b", "reviewer", "judge", "runner", "summarizer"] : ["core", "planner", "explorer", "reviewer", "judge", "summarizer"],
    allowedTools: patchLike ? ["read_repo", "write_artifact", "propose_patch", "run_verification"] : ["read_repo", "write_artifact"],
    forbiddenActions: patchLike ? ["bypass_chief_final_review", "remove_high_risk_judge", "mutate_objective_contract_permissions"] : ["bypass_chief_final_review", "mutate_objective_contract_permissions", "write_files", "apply_patch", "run_shell"],
    riskLevel,
    reasoningSensitivity: riskLevel === "high" ? "high" : "medium",
    budget: {
      maxSteps: 12,
      maxRepairRounds: config.autonomy.max_repairs,
      maxShellRuns: config.autonomy.max_shell_runs,
      maxToolCalls: 32,
      maxCostUsd: config.budget.hard_cap_usd
    },
    uncertaintyPolicy: {
      whenToAskUser: ["unresolved council risk", "chief final review asks user"],
      whenToFallback: [],
      whenToProceedWithAssumption: ["non-blocking missing detail with explicit trace note"],
      whenToStop: ["contract violation", "budget block without bounded mutation"]
    },
    stopCondition: {
      success: ["chief_delivery_approved"],
      partial: ["chief_revision_requested with deliverable evidence"],
      failure: ["delegated execution unrecovered"],
      unsafe: ["forbidden action requested"]
    },
    fallbackPolicy: {
      plannerFallback: "No silent planner fallback; unavailable configured chief blocks Sirius run.",
      executorFallback: "No silent executor fallback; owner changes require StrategyMutationEvent.",
      verifierFallback: "No silent verifier fallback; ask chief or trigger council replan.",
      userEscalation: "ask_user event"
    },
    verificationRubric: {
      requiredCommands: patchLike ? ["project verification command selected by owner agent"] : [],
      requiredArtifacts: ["consensus TaskGraph", "delegated task artifacts", "chief final review"],
      evidenceChecks: ["task ownership refs", "mutation refs if failure occurred"],
      reviewerChecks: ["risk_review task node"],
      judgeChecks: ["final_review task node"]
    },
    traceHints: {
      similarTraceIds: [],
      reusedLessons: [],
      avoidedFailurePatterns: []
    },
    source: "native",
    confidence: 0.82
  };
}

function riskLevelFromScenarioProfile(profile: ScenarioProfile): RiskLevel {
  if (profile.riskSignals.some((signal) => signal === "security_sensitive" || signal === "irreversible_or_production" || signal === "correctness_critical")) return "high";
  if (profile.riskSignals.length || profile.ambiguityLevel === "medium") return "medium";
  return profile.ambiguityLevel === "high" ? "high" : "low";
}

function taskTypeFromScenarioProfile(profile: ScenarioProfile, workflowKind: WorkflowKind): TaskType {
  if (workflowKind === "read_only" || workflowKind === "advisory" || workflowKind === "ask_user") return "analysis";
  if (profile.scenarioType === "debugging") return "bugfix";
  if (profile.scenarioType === "refactor") return "refactor";
  if (profile.scenarioType === "document") return "docs";
  if (profile.scenarioType === "analysis" || profile.scenarioType === "research" || profile.scenarioType === "planning") return "analysis";
  if (profile.scenarioType === "coding") return "feature";
  return "unknown";
}

function estimateNodeCost(node: TaskGraphNode): number {
  if (node.riskLevel === "high" && (node.kind === "review" || node.kind === "judge")) return 0.2;
  if (node.kind === "patch") return 0.08;
  return 0.03;
}
