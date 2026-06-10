import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import type { Plan } from "../../schemas/plan.js";
import type { JudgeDecision } from "../../schemas/judge.js";
import type { ModelBudgetStatus, ModelNote, ModelUsageSummary } from "../../schemas/modelNote.js";
import type { PatchCandidate } from "../../schemas/patchCandidate.js";
import type { ReviewReport } from "../../schemas/review.js";
import { makeId } from "../../utils/ids.js";
import { summarizeModelUsage } from "../model/costAccounting.js";
import type { AgentGraphState } from "../agentGraph/state.js";
import { runOfflineGraph } from "../agentGraph/executor.js";
import { externalAgentRegistryFromConfig } from "../externalAgents/externalAgentRegistry.js";
import { buildRoleGraph, type RoleGraph } from "../orchestration/roleGraph.js";
import { workflowKindFromPlan } from "../orchestration/workflowKind.js";
import type { RouteAssignment } from "../routing/policies.js";

export type WorkflowOptions = {
  providers?: string[];
  includeMock?: boolean;
  output?: "json" | "markdown";
  rounds?: number;
};

export type WorkflowResult = {
  id: string;
  task: string;
  createdAt: string;
  corePlan: CorePlan;
  debate: WorkflowTurn[];
  assignments: WorkflowAssignment[];
  executions: WorkflowTurn[];
  review: CoreReview;
  usageSummary: ModelUsageSummary;
  budgetStatus: ModelBudgetStatus;
  debateRounds: number;
  executorAlignment: WorkflowExecutorAlignment;
  reportPath: string;
};

export type WorkflowExecutorAlignment = {
  backend: "native";
  workflowKind: RoleGraph["workflowKind"];
  roleGraph: RoleGraph;
  sharedEventLedger: boolean;
  note: string;
};

export type CorePlan = {
  objective: string;
  decomposition: string[];
  agentRoles: Array<{ role: string; providerPreference: string; responsibility: string }>;
  acceptanceCriteria: string[];
  safetyRules: string[];
};

export type WorkflowTurn = {
  phase: "debate" | "execution";
  round: number;
  role: string;
  provider: string;
  model: string;
  prompt: string;
  content: string;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number };
  estimatedCostUsd?: number;
};

export type WorkflowAssignment = {
  role: string;
  provider: string;
  deliverable: string;
};

export type CoreReview = {
  verdict: "accepted" | "needs_revision";
  strengths: string[];
  gaps: string[];
  deliverySummary: string;
};

const workflowRoles: AgentRole[] = ["planner", "explorer", "coder_a", "coder_b", "reviewer", "judge", "repairer", "summarizer"];
const executableRoles = new Set<AgentRole>(["coder_a", "coder_b", "repairer"]);

export async function runWorkflowSimulation(cwd: string, task: string, config: TomorrowEdgeConfig, options: WorkflowOptions = {}): Promise<WorkflowResult> {
  const id = makeId("workflow");
  const createdAt = new Date().toISOString();
  const debateRounds = normalizeRounds(options.rounds ?? config.debate.max_rounds);
  const executorConfig = buildExecutorSimulationConfig(config, options, debateRounds);
  const executorTask = buildExecutorSimulationTask(task);
  const state = await runOfflineGraph(cwd, executorTask, executorConfig, {
    accessMode: "partial",
    dryRun: true,
    liveAdvisory: true,
    livePatch: true,
    repairOnFail: false,
    fixtureMode: shouldUseFixtureMode(options),
    provider: options.providers?.includes("fixture") ? "fixture" : options.providers?.includes("mock") ? "mock" : undefined,
    conversationTarget: "core"
  });

  const resultWithoutReport: Omit<WorkflowResult, "reportPath"> = {
    id,
    task,
    createdAt,
    corePlan: projectCorePlan(state),
    debate: projectDebateTurns(state),
    assignments: projectAssignments(state),
    executions: projectExecutionTurns(state),
    review: projectCoreReview(state),
    usageSummary: state.usageSummary ?? summarizeModelUsage(state.modelNotes),
    budgetStatus: latestBudgetStatus(state, executorConfig.debate.max_cost_usd),
    debateRounds,
    executorAlignment: buildWorkflowExecutorAlignment(state)
  };
  const report = renderWorkflowReport({ ...resultWithoutReport, reportPath: "" });
  const reportPath = await saveWorkflowReport(cwd, id, report);

  return {
    ...resultWithoutReport,
    reportPath
  };
}

function buildExecutorSimulationConfig(config: TomorrowEdgeConfig, options: WorkflowOptions, rounds: number): TomorrowEdgeConfig {
  const requested = options.providers?.filter(Boolean) ?? [];
  const next: TomorrowEdgeConfig = {
    ...config,
    project: { ...config.project, access_mode: "partial" },
    routing: { ...config.routing, max_cost_usd: Math.min(config.routing.max_cost_usd, config.debate.max_cost_usd) },
    debate: { ...config.debate, max_rounds: rounds },
    providers: Object.fromEntries(Object.entries(config.providers).map(([id, provider]) => [id, { ...provider }])) as TomorrowEdgeConfig["providers"],
    agents: Object.fromEntries(Object.entries(config.agents).map(([role, agent]) => [role, { ...agent }])) as TomorrowEdgeConfig["agents"],
    external_agents: Object.fromEntries(Object.entries(config.external_agents ?? {}).map(([id, agent]) => [id, { ...agent, args: [...agent.args], env: { ...agent.env }, roles: [...agent.roles], capabilities: [...agent.capabilities] }])) as TomorrowEdgeConfig["external_agents"]
  };

  if (options.includeMock || requested.includes("mock")) {
    next.providers.mock = { ...next.providers.mock, enabled: true };
  }
  if (requested.includes("fixture")) {
    next.providers.fixture = { ...next.providers.fixture, enabled: true };
  }

  const providerCycle = requested.filter((provider) => !provider.startsWith("external:") && !next.external_agents[provider]);
  const externalCycle = requested
    .map((provider) => provider.startsWith("external:") ? provider.slice("external:".length) : provider)
    .filter((id) => Boolean(next.external_agents[id]));

  if (providerCycle.length) {
    workflowRoles.forEach((role, index) => {
      const provider = providerCycle[Math.min(index, providerCycle.length - 1)];
      next.agents[role] = {
        ...(next.agents[role] ?? { provider: "auto", model: "auto" }),
        provider,
        model: providerModel(next, provider),
        reason: "workflow simulation provider selection"
      };
    });
  }

  for (const externalId of externalCycle) {
    const profile = next.external_agents[externalId];
    profile.enabled = true;
    for (const role of profile.roles) {
      next.agents[role] = {
        ...(next.agents[role] ?? { provider: "auto", model: "auto" }),
        provider: `external:${externalId}`,
        model: profile.name ?? externalId,
        reason: "workflow simulation external agent selection"
      };
    }
  }

  return next;
}

function buildExecutorSimulationTask(task: string): string {
  return [
    `Workflow simulation dry-run for the user task: ${task}`,
    "Produce a non-mutating patch workflow with planner, explorer, candidate patch, reviewer, judge, and summary artifacts.",
    "Do not apply patches or run shell commands; the executor dryRun flag will enforce this."
  ].join("\n");
}

function shouldUseFixtureMode(options: WorkflowOptions): boolean {
  return Boolean(options.providers?.includes("fixture") && !options.providers.includes("mock"));
}

function providerModel(config: TomorrowEdgeConfig, provider: string): string {
  return config.providers[provider]?.model?.trim() || (provider === "mock" ? "mock-balanced" : provider === "fixture" ? "fixture-scripted" : "configured-model");
}

function projectCorePlan(state: AgentGraphState): CorePlan {
  const plan = state.plan;
  return {
    objective: state.goal,
    decomposition: plan?.steps.length
      ? plan.steps.map((step) => `${step.title}: ${step.detail}`)
      : ["Native executor did not produce a structured plan."],
    agentRoles: state.routing.assignments
      .filter((assignment) => assignment.role !== "runner")
      .map((assignment) => ({
        role: assignment.role,
        providerPreference: `${assignment.provider}/${assignment.model}`,
        responsibility: assignment.reason
      })),
    acceptanceCriteria: buildAcceptanceCriteria(plan, state),
    safetyRules: [
      "Workflow simulation runs through NativeBackend with dryRun=true.",
      "Selected patches are recorded but not applied.",
      "Shell verification is not executed during simulation.",
      "All native executor events remain available in the shared event ledger."
    ]
  };
}

function buildAcceptanceCriteria(plan: Plan | undefined, state: AgentGraphState): string[] {
  const criteria = [
    ...(plan?.constraints ?? []),
    ...(plan?.verificationCommands?.map((command) => `Verification command proposed: ${command}`) ?? [])
  ];
  if (state.candidates.length) criteria.push(`${state.candidates.length} patch candidate(s) were produced for review.`);
  if (state.review) criteria.push("Reviewer report was produced by the NativeBackend.");
  if (state.judge) criteria.push("Judge decision was produced by the NativeBackend.");
  return criteria.length ? criteria : ["Native executor completed a traceable advisory workflow."];
}

function projectAssignments(state: AgentGraphState): WorkflowAssignment[] {
  const deliverables: Partial<Record<AgentRole, string>> = {
    planner: "Structured plan, workflow intent, and risk posture.",
    explorer: "Selected repo context and excluded-file rationale.",
    coder_a: "Primary patch candidate or implementation plan.",
    coder_b: "Alternative patch candidate for debate.",
    reviewer: "Candidate review and blocking concerns.",
    judge: "Final selection/request-revision decision.",
    repairer: "Repair candidate if verification fails.",
    summarizer: "Final summary and trace completeness."
  };
  return state.routing.assignments
    .filter((assignment) => assignment.role !== "runner")
    .map((assignment) => ({
      role: assignment.role,
      provider: assignment.provider,
      deliverable: deliverables[assignment.role] ?? assignment.reason
    }));
}

function projectDebateTurns(state: AgentGraphState): WorkflowTurn[] {
  if (latestBudgetStatus(state, 0).status === "blocked") return [];
  const notes = state.modelNotes
    .filter((note) => note.kind.includes("advice") || note.kind === "review_advice" || note.kind === "judge_advice")
    .map((note, index) => turnFromModelNote(note, "debate", index + 1));
  const rounds = state.debateRounds.map((round, index) => {
    const assignment = assignmentForSpeaker(state.routing.assignments, round.speaker);
    return {
      phase: "debate" as const,
      round: round.round,
      role: round.speaker,
      provider: assignment?.provider ?? "native",
      model: assignment?.model ?? "debate",
      prompt: `candidate=${round.targetCandidateId ?? "none"}`,
      content: [
        round.claim,
        `Evidence: ${round.evidence.join("; ")}`,
        round.riskRaised ? `Risk: ${round.riskRaised}` : ""
      ].filter(Boolean).join("\n")
    };
  });
  const externalTurns = state.events
    .filter((event) => event.type === "external_agent_result")
    .map((event, index) => ({
      phase: "debate" as const,
      round: index + 1,
      role: event.role ?? "external",
      provider: event.provider ?? (event.externalAgentId ? `external:${event.externalAgentId}` : "external"),
      model: event.model ?? event.externalAgentId ?? "external_agent",
      prompt: "external typed role result",
      content: event.summary
    }));
  return [...notes, ...rounds, ...externalTurns].sort((a, b) => a.round - b.round || a.role.localeCompare(b.role));
}

function projectExecutionTurns(state: AgentGraphState): WorkflowTurn[] {
  if (latestBudgetStatus(state, 0).status === "blocked") return [];
  const candidates = state.candidates.map((candidate, index) => turnFromCandidate(state, candidate, index + 1));
  const review = state.review ? [turnFromReview(state, state.review, candidates.length + 1)] : [];
  const judge = state.judge ? [turnFromJudge(state, state.judge, candidates.length + review.length + 1)] : [];
  return [...candidates, ...review, ...judge];
}

function turnFromModelNote(note: ModelNote, phase: WorkflowTurn["phase"], round: number): WorkflowTurn {
  return {
    phase,
    round,
    role: note.role,
    provider: note.provider,
    model: note.model,
    prompt: note.kind,
    content: note.content,
    error: note.error,
    usage: note.usage,
    estimatedCostUsd: note.estimatedCostUsd
  };
}

function turnFromCandidate(state: AgentGraphState, candidate: PatchCandidate, round: number): WorkflowTurn {
  const assignment = assignmentForSpeaker(state.routing.assignments, candidate.agentId);
  return {
    phase: "execution",
    round,
    role: candidate.agentId,
    provider: assignment?.provider ?? "native",
    model: assignment?.model ?? "patch_candidate",
    prompt: candidate.approach,
    content: [
      candidate.summary,
      `Files: ${candidate.filesChanged.join(", ") || "none"}`,
      `Risk: ${candidate.estimatedRisk}`,
      candidate.unifiedDiff ? "Diff: recorded in NativeBackend artifact ledger." : "Diff: none"
    ].join("\n")
  };
}

function turnFromReview(state: AgentGraphState, review: ReviewReport, round: number): WorkflowTurn {
  const agent = lastAgentForRole(state, "reviewer");
  return {
    phase: "execution",
    round,
    role: "reviewer",
    provider: agent?.provider ?? assignmentForSpeaker(state.routing.assignments, "reviewer")?.provider ?? "native",
    model: agent?.model ?? assignmentForSpeaker(state.routing.assignments, "reviewer")?.model ?? "reviewer",
    prompt: "review candidates",
    content: [
      review.overallRecommendation,
      ...review.reviews.map((item) => `${item.candidateId}: ${item.recommendation}, correctness=${item.correctnessScore}, risk=${item.riskScore}`)
    ].join("\n")
  };
}

function turnFromJudge(state: AgentGraphState, judge: JudgeDecision, round: number): WorkflowTurn {
  const agent = lastAgentForRole(state, "judge");
  return {
    phase: "execution",
    round,
    role: "judge",
    provider: agent?.provider ?? assignmentForSpeaker(state.routing.assignments, "judge")?.provider ?? "native",
    model: agent?.model ?? assignmentForSpeaker(state.routing.assignments, "judge")?.model ?? "judge",
    prompt: "judge reviewed candidates",
    content: `${judge.decision}: ${judge.reason}`,
    estimatedCostUsd: undefined
  };
}

function assignmentForSpeaker(assignments: RouteAssignment[], speaker: string): RouteAssignment | undefined {
  const role = speaker === "opponent" ? "reviewer" : speaker;
  return assignments.find((assignment) => assignment.role === role);
}

function lastAgentForRole(state: AgentGraphState, role: AgentRole) {
  return [...state.agents].reverse().find((agent) => agent.role === role);
}

function projectCoreReview(state: AgentGraphState): CoreReview {
  const gaps = collectGaps(state);
  const budgetBlocked = latestBudgetStatus(state, 0).status === "blocked";
  if (budgetBlocked && !gaps.some((gap) => gap.includes("Budget"))) {
    gaps.push(latestBudgetStatus(state, 0).reason);
  }
  const strengths = [
    "Workflow simulation reused the NativeBackend executor instead of a separate provider loop.",
    `${state.events.length} event(s) recorded in the shared event ledger.`,
    `${state.candidates.length} patch candidate(s), ${state.debateRounds.length} debate turn(s), ${state.evidencePackets.length} evidence packet(s).`
  ];
  if (state.events.some((event) => event.type === "external_agent_result")) strengths.push("External agents contributed explicit reviewer/judge stances.");
  if (state.traceCompleteness) strengths.push(`Trace completeness score: ${state.traceCompleteness.score}.`);
  return {
    verdict: gaps.length ? "needs_revision" : "accepted",
    strengths,
    gaps,
    deliverySummary: gaps.length
      ? `Native executor dry-run for "${state.goal}" needs revision: ${gaps[0]}`
      : `Native executor dry-run for "${state.goal}" is accepted as a traceable non-mutating workflow.`
  };
}

function collectGaps(state: AgentGraphState): string[] {
  const gaps = state.agents
    .filter((agent) => agent.status === "failed" || agent.status === "blocked")
    .map((agent) => `${agent.role}/${agent.provider}: ${agent.summary}`);
  if (!state.plan) gaps.push("Planner did not produce a plan.");
  if (!state.contextSelection) gaps.push("Explorer did not produce context selection.");
  if (state.plan?.requiresPatchWorkflow !== false && !state.candidates.length) gaps.push("No patch candidate was produced.");
  if (!state.review && state.candidates.length) gaps.push("Reviewer report is missing.");
  if (!state.judge && state.review) gaps.push("Judge decision is missing.");
  return [...new Set(gaps)];
}

function latestBudgetStatus(state: AgentGraphState, maxCostUsd: number): ModelBudgetStatus {
  const blocked = [...state.budgetStatuses].reverse().find((status) => status.status === "blocked");
  return blocked ?? state.budgetStatuses.at(-1) ?? state.budgetStatus ?? {
    status: "within_budget",
    maxCostUsd,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    estimatedCostUsd: 0,
    reason: "No live workflow budget gate was required."
  };
}

function buildWorkflowExecutorAlignment(state: AgentGraphState): WorkflowExecutorAlignment {
  const workflowKind = state.roleGraph?.workflowKind ?? buildRoleGraph({
    workflowKind: workflowKindFromPlan(state.plan),
    highRisk: state.plan?.riskLevel === "high",
    debate: Boolean(state.plan?.debateRecommended)
  }).workflowKind;
  const roleGraph = state.roleGraph ?? buildRoleGraph({
    workflowKind: workflowKindFromPlan(state.plan),
    highRisk: state.plan?.riskLevel === "high",
    debate: Boolean(state.plan?.debateRecommended)
  });
  return {
    backend: "native",
    workflowKind,
    roleGraph,
    sharedEventLedger: true,
    note: "Workflow simulation is now a NativeBackend dry-run projection: executor owns planner/explorer/coder/reviewer/judge flow, while this module renders the legacy WorkflowResult/report."
  };
}

function renderWorkflowReport(result: WorkflowResult): string {
  return [
    `# Workflow ${result.id}`,
    `Task: ${result.task}`,
    `Created: ${result.createdAt}`,
    `Debate rounds requested: ${result.debateRounds}`,
    `Budget: ${result.budgetStatus.status} (${result.budgetStatus.reason})`,
    "## Cost Governance",
    renderCostGovernance(result),
    "## Native Executor Alignment",
    renderExecutorAlignment(result.executorAlignment),
    "## Core Plan",
    renderCorePlan(result.corePlan),
    "## Debate",
    renderTurns(result.debate),
    "## Assignments",
    result.assignments.map((assignment) => `- ${assignment.role} -> ${assignment.provider}: ${assignment.deliverable}`).join("\n"),
    "## Execution",
    renderTurns(result.executions),
    "## Core Review",
    `Verdict: ${result.review.verdict}`,
    `Strengths:\n${result.review.strengths.map((item) => `- ${item}`).join("\n")}`,
    `Gaps:\n${result.review.gaps.length ? result.review.gaps.map((item) => `- ${item}`).join("\n") : "- none"}`,
    result.review.deliverySummary
  ].join("\n\n");
}

function renderCorePlan(plan: CorePlan): string {
  return [
    `Objective: ${plan.objective}`,
    `Decomposition:\n${plan.decomposition.map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
    `Roles:\n${plan.agentRoles.map((role) => `- ${role.role} (${role.providerPreference}): ${role.responsibility}`).join("\n")}`,
    `Acceptance criteria:\n${plan.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}`,
    `Safety rules:\n${plan.safetyRules.map((item) => `- ${item}`).join("\n")}`
  ].join("\n\n");
}

function renderTurns(turns: WorkflowTurn[]): string {
  if (!turns.length) return "- none";
  return turns.map((turn) => `## ${turn.phase} round ${turn.round}: ${turn.role} via ${turn.provider}/${turn.model}\n${turn.error ? `ERROR: ${turn.error}` : turn.content}`).join("\n\n");
}

function renderExecutorAlignment(alignment: WorkflowExecutorAlignment): string {
  return [
    `Backend: ${alignment.backend}`,
    `Workflow kind: ${alignment.workflowKind}`,
    `Shared event ledger: ${alignment.sharedEventLedger ? "yes" : "no"}`,
    alignment.note,
    "Role graph:",
    ...alignment.roleGraph.nodes.map((node) => `- ${node.id} (${node.role}) after=${node.dependencies.join(",") || "-"} produces=${node.produces.join(",") || "-"}`),
    `Stop conditions: ${alignment.roleGraph.stopConditions.join(", ")}`
  ].join("\n");
}

function renderCostGovernance(result: WorkflowResult): string {
  const allTurns = [...result.debate, ...result.executions];
  const byProvider = new Map<string, { turns: number; tokens: number; cost?: number }>();
  for (const turn of allTurns) {
    const item = byProvider.get(turn.provider) ?? { turns: 0, tokens: 0 };
    item.turns += 1;
    item.tokens += (turn.usage?.inputTokens ?? 0) + (turn.usage?.outputTokens ?? 0);
    if (turn.estimatedCostUsd !== undefined) item.cost = (item.cost ?? 0) + turn.estimatedCostUsd;
    byProvider.set(turn.provider, item);
  }
  const rows = [...byProvider.entries()].map(([provider, item]) => `- ${provider}: turns=${item.turns}, tokens=${item.tokens}${item.cost === undefined ? ", cost=unknown" : `, cost=$${item.cost.toFixed(6)}`}`);
  return [
    `Total tokens: ${result.usageSummary.totalTokens}`,
    `Estimated cost: ${result.usageSummary.estimatedCostUsd === undefined ? "unknown" : `$${result.usageSummary.estimatedCostUsd.toFixed(6)}`}`,
    `Budget status: ${result.budgetStatus.status}`,
    "Budget allocation policy: reserve expensive/strong agents for core, planner, reviewer, and judge; route implementation and repair to efficient coding agents; keep privacy-sensitive work local or explicitly external.",
    rows.length ? rows.join("\n") : "- no turns recorded"
  ].join("\n");
}

function normalizeRounds(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(5, Math.max(1, Math.trunc(value)));
}

async function saveWorkflowReport(cwd: string, id: string, content: string): Promise<string> {
  const dir = path.join(cwd, ".tomorrowedge", "workflows");
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.md`);
  await writeFile(filePath, `\uFEFF${content}`, "utf8");
  return filePath;
}
