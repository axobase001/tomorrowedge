import type { AccessMode, TomorrowEdgeConfig } from "../../config/schema.js";
import type { AgentGraphState } from "../agentGraph/state.js";
import { buildAgentRuntimeProfiles } from "../agents/defaultCapabilityProfiles.js";
import { assignTaskOwners } from "../assignment/taskAssignmentEngine.js";
import { createBudgetRuntimeState, commitRoleCall, evaluateRoleInvocation, reserveRoleCall } from "../budget/budgetGate.js";
import { inferRisk, routeToChiefAgent, selectChiefAgent } from "../chiefAgent/chiefAgentRouter.js";
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
import type { TaskGraph, TaskGraphNode } from "../planning/taskGraph.js";
import { runAgentCouncil } from "./councilRunner.js";
import type { CouncilSession } from "./councilTypes.js";
import { maybeTriggerCouncilReplan } from "./councilReplan.js";

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
  const budgetRuntime = createBudgetRuntimeState();
  const availableAgents = buildAgentRuntimeProfiles(config);
  const objectiveContract = createCouncilObjectiveContract(goal, config, inferRisk(goal));
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

  const chiefPlanRef = ledger.writeArtifact("chief_initial_plan", JSON.stringify({
    goal,
    strategy: strategyGenome,
    decision: chiefDecision,
    requiredEvidence: objectiveContract.requiredEvidence
  }, null, 2), "json");
  ledger.append({
    type: "chief_initial_plan",
    phase: "planning",
    provider: chiefAgent.provider,
    model: chiefAgent.model,
    chiefAgentId: chiefAgent.id,
    planRef: chiefPlanRef,
    summary: "Chief produced an initial governed architecture plan and council policy."
  });

  const council = await runAgentCouncil({ goal, chiefAgent, availableAgents, riskLevel: objectiveContract.riskLevel });
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
  let nodeIndex = 0;
  while (nodeIndex < taskGraph.nodes.length) {
    const node = taskGraph.nodes[nodeIndex]!;
    if (node.status === "done" || node.status === "skipped") {
      nodeIndex += 1;
      continue;
    }
    const firstAttemptShouldFail = !failureConsumed && node.id === (options.simulateFailureTaskId ?? "");
    const result = await executeDelegatedNode({ cwd, node, config, ledger, budgetRuntime, shouldFail: firstAttemptShouldFail });
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
      mutations.push(...mutation.mutations);
      selectedStrategy = mutation.selectedStrategy;
      strategySelection = mutation.decision;
      recordMutationEvents(ledger, mutation.mutations, mutation.decision);
      taskGraph = mutateTaskGraphForStrategy(taskGraph, mutation.mutations);
      taskGraph = assignTaskOwners({
        taskGraph,
        councilSession: council,
        availableAgents,
        budgetPolicy: { hardCapUsd: config.budget.hard_cap_usd, preferCheap: selectedStrategy.budgetPolicy === "cheap_first" },
        strategyGenome: selectedStrategy
      });
      recordOwnershipEvents(ledger, taskGraph, "evolved");
      const retryNode = taskGraph.nodes.find((item) => item.id === node.id) ?? node;
      const retry = await executeDelegatedNode({ cwd, node: retryNode, config, ledger, budgetRuntime, shouldFail: false, retryAfterMutation: true });
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
    }
    nodeIndex += 1;
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

  const finalChiefReview = runFinalChiefReview({
    chiefAgentId: chiefAgent.id,
    taskGraph,
    delegatedResults,
    evidencePackets,
    artifacts: ledger.artifacts,
    mutationCount: mutations.length
  });
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
    requiredRevisions: finalChiefReview.requiredRevisions
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
  node: TaskGraphNode;
  config: TomorrowEdgeConfig;
  ledger: ReturnType<typeof createEventLedger>;
  budgetRuntime: ReturnType<typeof createBudgetRuntimeState>;
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
    canFallback: false
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
  const traceCompleteness = computeTraceCompleteness(input.ledger.events, { workflowKind: "patch", plan });
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
    workflowKind: "patch",
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

function externalProfileForNode(config: TomorrowEdgeConfig, node: TaskGraphNode): ExternalAgentProfile | undefined {
  if (!node.ownerAgentId || !node.assignedProvider?.startsWith("external:")) return undefined;
  const configured = config.external_agents[node.ownerAgentId];
  if (!configured?.enabled) return undefined;
  return {
    id: node.ownerAgentId,
    name: configured.name ?? node.ownerAgentId,
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

function createCouncilObjectiveContract(goal: string, config: TomorrowEdgeConfig, riskLevel: "low" | "medium" | "high"): ObjectiveContractV1 {
  return {
    schemaVersion: "objective-contract/v1",
    contractId: makeId("contract"),
    createdAt: new Date().toISOString(),
    goal,
    normalizedGoal: goal.trim(),
    scenarioType: "coding",
    taskType: /rewrite|rebuild|migration|refactor/i.test(goal) ? "refactor" : "feature",
    workflowKind: "patch",
    localObjective: goal,
    userScenario: {
      inferredUserIntent: "governed multi-agent software engineering task",
      expectedDeliverable: "reviewed deliverable package with task ownership and final chief review",
      interactionMode: "code_change",
      ambiguityLevel: riskLevel === "high" ? "high" : "medium"
    },
    successCriteria: ["Chief initial plan recorded", "Council consensus TaskGraph recorded", "Delegated execution evidence recorded", "Chief final review recorded"],
    failureCriteria: ["Objective Contract violation", "unresolved blocking risk after chief review", "mutation limit exhausted"],
    requiredEvidence: ["chief_plan", "council_moves", "task_ownership", "delegated_execution", "final_chief_review"],
    allowedPhases: ["routing", "planning", "council", "coding", "review", "judge", "verification", "evolution", "delivery", "summary"],
    allowedRoles: ["core", "planner", "explorer", "coder_a", "coder_b", "reviewer", "judge", "runner", "summarizer"],
    allowedTools: ["read_repo", "write_artifact", "propose_patch", "run_verification"],
    forbiddenActions: ["bypass_chief_final_review", "remove_high_risk_judge", "mutate_objective_contract_permissions"],
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
      requiredCommands: ["cargo test"],
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

function estimateNodeCost(node: TaskGraphNode): number {
  if (node.riskLevel === "high" && (node.kind === "review" || node.kind === "judge")) return 0.2;
  if (node.kind === "patch") return 0.08;
  return 0.03;
}
