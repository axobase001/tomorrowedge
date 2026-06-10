import type { AgentRole } from "../../schemas/agentTask.js";
import type { Plan, PlanStep } from "../../schemas/plan.js";
import type { ObjectiveContractV1 } from "../contracts/objectiveContract.js";
import type { EventPhase } from "../events/eventTypes.js";
import type { RoleGraph } from "../orchestration/roleGraph.js";
import { workflowKindFromPlan } from "../orchestration/workflowKind.js";
import type { OrchestrationPolicyGenome } from "../orchestrationPolicy/orchestrationPolicy.js";
import type { TaskGraph, TaskGraphNode } from "./taskGraph.js";

export type BuildTaskGraphInput = {
  plan: Plan;
  contract?: ObjectiveContractV1;
  roleGraph?: RoleGraph;
  policy?: OrchestrationPolicyGenome;
};

export function buildTaskGraph(input: BuildTaskGraphInput): TaskGraph {
  const workflowKind = input.plan.workflowKind ?? input.contract?.workflowKind ?? workflowKindFromPlan(input.plan);
  const maxNodes = input.policy?.taskGraphPolicy?.maxTaskNodes ?? 16;
  const planSteps = input.plan.steps.length ? input.plan.steps : fallbackPlanSteps(input.plan);
  const limitedSteps = planSteps.slice(0, maxNodes);
  const nodes = limitedSteps.map((step, index) => nodeFromPlanStep(step, index, input, limitedSteps));
  const repairedNodes = ensureGovernanceNodes(nodes, input);
  const edges = repairedNodes.flatMap((node) => node.dependencies.map((from) => ({
    from,
    to: node.id,
    reason: "Plan step dependency"
  })));
  const dependencyTargets = new Set(repairedNodes.flatMap((node) => node.dependencies));
  return {
    graphId: `task_graph_${stableId(input.plan.goal)}`,
    goal: input.plan.goal,
    workflowKind,
    riskLevel: input.plan.riskLevel,
    nodes: repairedNodes,
    edges,
    entryNodeIds: repairedNodes.filter((node) => node.dependencies.length === 0).map((node) => node.id),
    terminalNodeIds: repairedNodes.filter((node) => !dependencyTargets.has(node.id)).map((node) => node.id)
  };
}

export function fallbackPlanSteps(plan: Plan): PlanStep[] {
  return [
    { id: "understand", title: "Understand objective", detail: plan.goal, status: "done" },
    { id: "deliver", title: plan.taskType === "analysis" ? "Summarize findings" : "Produce candidate", detail: "Complete the smallest evidence-backed workflow.", status: "pending" }
  ];
}

function nodeFromPlanStep(step: PlanStep, index: number, input: BuildTaskGraphInput, planSteps: PlanStep[]): TaskGraphNode {
  const phase = phaseForStep(step, input.plan);
  const roleHints = roleHintsForPhase(phase, step, input);
  const dependencies = index === 0 ? [] : [sanitizeNodeId(planSteps[index - 1]?.id || `step-${index}`)];
  return {
    id: sanitizeNodeId(step.id || `step-${index + 1}`),
    title: step.title,
    detail: step.detail,
    phase,
    roleHints,
    dependencies,
    requiredEvidence: requiredEvidenceForNode(step, phase, input),
    expectedArtifacts: expectedArtifactsForPhase(phase),
    status: step.status === "done" ? "done" : step.status === "blocked" ? "blocked" : "pending"
  };
}

function ensureGovernanceNodes(nodes: TaskGraphNode[], input: BuildTaskGraphInput): TaskGraphNode[] {
  const workflowKind = input.plan.workflowKind ?? input.contract?.workflowKind ?? workflowKindFromPlan(input.plan);
  if (workflowKind === "read_only" || workflowKind === "advisory" || workflowKind === "ask_user") return nodes;
  if (input.plan.riskLevel !== "high" && input.contract?.riskLevel !== "high") return nodes;
  const next = [...nodes];
  const lastId = next.at(-1)?.id;
  if (!next.some((node) => node.roleHints.includes("reviewer"))) {
    next.push({
      id: "review-governance",
      title: "Review high-risk candidate",
      detail: "High-risk contracts require an explicit reviewer evidence gate.",
      phase: "review",
      roleHints: ["reviewer"],
      dependencies: lastId ? [lastId] : [],
      requiredEvidence: ["patch candidate", "review decision"],
      expectedArtifacts: ["review"],
      status: "pending"
    });
  }
  if (!next.some((node) => node.roleHints.includes("judge"))) {
    next.push({
      id: "judge-governance",
      title: "Judge high-risk candidate",
      detail: "High-risk contracts require a judge decision before mutation.",
      phase: "judge",
      roleHints: ["judge"],
      dependencies: [next.at(-1)!.id],
      requiredEvidence: ["review decision", "judge decision"],
      expectedArtifacts: ["judge"],
      status: "pending"
    });
  }
  return next;
}

function phaseForStep(step: PlanStep, plan: Plan): EventPhase {
  const text = `${step.id} ${step.title} ${step.detail}`.toLowerCase();
  if (plan.taskType === "analysis" || plan.workflowKind === "read_only" || plan.workflowKind === "advisory" || plan.workflowKind === "ask_user") {
    if (/summary|summarize|deliver|answer|findings/.test(text)) return "summary";
    if (/review|judge/.test(text)) return "review";
    return /plan|contract/.test(text) ? "planning" : "exploration";
  }
  if (/vision|screenshot|image/.test(text)) return "vision";
  if (/explore|inspect|context|read|scan/.test(text)) return "exploration";
  if (/implement|patch|code|fix|repair candidate|produce candidate/.test(text)) return "coding";
  if (/review|red.team|risk/.test(text)) return "review";
  if (/judge|select|decision/.test(text)) return "judge";
  if (/verify|test|shell|command/.test(text)) return "verification";
  if (/repair/.test(text)) return "repair";
  if (/summary|summarize|deliver|answer/.test(text)) return "summary";
  return "planning";
}

function roleHintsForPhase(phase: EventPhase, step: PlanStep, input: BuildTaskGraphInput): AgentRole[] {
  const explicit = input.roleGraph?.nodes.filter((node) => node.produces.some((item) => step.detail.toLowerCase().includes(item.replace("_", " ")))).map((node) => node.role) ?? [];
  if (explicit.length) return uniqueRoles(explicit);
  if (phase === "vision") return ["vision"];
  if (phase === "exploration") return ["explorer"];
  if (phase === "coding") return ["coder_a"];
  if (phase === "review") return ["reviewer"];
  if (phase === "judge") return ["judge"];
  if (phase === "patch" || phase === "shell" || phase === "verification") return ["runner"];
  if (phase === "repair") return ["repairer"];
  if (phase === "summary") return ["summarizer"];
  return ["planner"];
}

function requiredEvidenceForNode(step: PlanStep, phase: EventPhase, input: BuildTaskGraphInput): string[] {
  const base = new Set<string>();
  if (input.policy?.planningPolicy.requirePlanStepEvidenceBinding !== false) {
    for (const item of input.contract?.requiredEvidence ?? input.plan.acceptanceCriteria ?? []) base.add(item);
  }
  if (phase === "coding") base.add("patch candidate");
  if (phase === "review") base.add("review decision");
  if (phase === "judge") base.add("judge decision");
  if (phase === "verification") base.add("test evidence");
  if (/evidence/i.test(step.detail)) base.add(step.detail);
  return [...base].slice(0, 8);
}

function expectedArtifactsForPhase(phase: EventPhase): string[] {
  if (phase === "coding") return ["diff"];
  if (phase === "review") return ["review"];
  if (phase === "judge") return ["judge"];
  if (phase === "verification" || phase === "shell") return ["stdout", "stderr"];
  if (phase === "summary") return ["trace"];
  return ["json"];
}

function stableId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "default";
}

function sanitizeNodeId(value: string): string {
  return stableId(value) || "node";
}

function uniqueRoles(roles: AgentRole[]): AgentRole[] {
  return [...new Set(roles)];
}
