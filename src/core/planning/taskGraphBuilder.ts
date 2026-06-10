import type { AgentRole } from "../../schemas/agentTask.js";
import type { Plan, PlanStep, RiskLevel, TaskType } from "../../schemas/plan.js";
import type { ObjectiveContractV1 } from "../contracts/objectiveContract.js";
import type { EventPhase } from "../events/eventTypes.js";
import type { RoleGraph } from "../orchestration/roleGraph.js";
import { workflowKindFromPlan, type WorkflowKind } from "../orchestration/workflowKind.js";
import type { OrchestrationPolicyGenome } from "../orchestrationPolicy/orchestrationPolicy.js";
import type { EvidenceRequirement, ExpectedOutput, TaskGraph, TaskGraphNode, TaskNodeKind } from "./taskGraph.js";

export type BuildTaskGraphInput = {
  plan: Plan;
  contract?: ObjectiveContractV1;
  roleGraph?: RoleGraph;
  policy?: OrchestrationPolicyGenome;
};

export type BuildTaskGraphFromContractInput = {
  goal: string;
  workflowKind: WorkflowKind;
  planSteps: PlanStep[];
  contract?: ObjectiveContractV1;
  riskLevel: RiskLevel;
  taskType: TaskType;
  verificationCommands?: string[];
  policy?: OrchestrationPolicyGenome;
};

type NodeSpec = {
  id: string;
  kind: TaskNodeKind;
  title: string;
  objective: string;
  phase: EventPhase;
  ownerRole: AgentRole;
  dependsOn?: string[];
  requiredInputs?: EvidenceRequirement[];
  expectedOutputs?: ExpectedOutput[];
  files?: string[];
  riskLevel?: RiskLevel;
  mutationAllowed?: boolean;
  canRunInParallel?: boolean;
  stopIfFails?: boolean;
  fallbackRole?: AgentRole;
  acceptanceCriteria?: string[];
  status?: TaskGraphNode["status"];
};

export function buildTaskGraph(input: BuildTaskGraphInput): TaskGraph {
  return buildTaskGraphFromContract({
    goal: input.plan.goal,
    workflowKind: input.plan.workflowKind ?? input.contract?.workflowKind ?? workflowKindFromPlan(input.plan),
    planSteps: input.plan.steps.length ? input.plan.steps : fallbackPlanSteps(input.plan),
    contract: input.contract,
    riskLevel: input.plan.riskLevel,
    taskType: input.plan.taskType,
    verificationCommands: input.plan.verificationCommands,
    policy: input.policy
  });
}

export function buildTaskGraphFromContract(input: BuildTaskGraphFromContractInput): TaskGraph {
  const workflowKind = input.workflowKind;
  const riskLevel = strongerRisk(input.riskLevel, input.contract?.riskLevel ?? input.riskLevel);
  const maxNodes = input.policy?.taskGraphPolicy?.maxTaskNodes ?? 16;
  const specs = specsForWorkflow({ ...input, riskLevel }).slice(0, maxNodes);
  const nodes = specs.map((spec) => materializeNode(spec, input, riskLevel));
  const edges = nodes.flatMap((node) => node.dependsOn.map((from) => ({
    from,
    to: node.id,
    reason: "Task dependency"
  })));
  const dependencyTargets = new Set(nodes.flatMap((node) => node.dependsOn));
  return {
    schemaVersion: "task-graph/v1",
    graphId: `task_graph_${stableId(input.goal)}`,
    goal: input.goal,
    rootObjective: input.contract?.localObjective ?? input.goal,
    workflowKind,
    riskLevel,
    nodes,
    edges,
    entryNodeIds: nodes.filter((node) => node.dependsOn.length === 0).map((node) => node.id),
    terminalNodeIds: nodes.filter((node) => !dependencyTargets.has(node.id)).map((node) => node.id),
    stopConditions: input.contract?.stopCondition.failure ?? stopConditionsForWorkflow(workflowKind),
    riskBoundaries: riskBoundariesForWorkflow(workflowKind, riskLevel, input.contract)
  };
}

export function fallbackPlanSteps(plan: Plan): PlanStep[] {
  return [
    { id: "inspect_context", title: "Inspect context", detail: plan.goal, status: "done" },
    { id: "summarize", title: plan.taskType === "analysis" ? "Summarize findings" : "Summarize outcome", detail: "Complete the smallest evidence-backed workflow.", status: "pending" }
  ];
}

function specsForWorkflow(input: BuildTaskGraphFromContractInput): NodeSpec[] {
  if (input.workflowKind === "read_only" || input.workflowKind === "advisory") return readOnlySpecs(input);
  if (input.workflowKind === "ask_user") return askUserSpecs(input);
  if (input.workflowKind === "repair") return repairLoopSpecs(input);
  if (input.riskLevel === "high") return highRiskPatchSpecs(input);
  return patchSpecs(input);
}

function readOnlySpecs(input: BuildTaskGraphFromContractInput): NodeSpec[] {
  const criteria = input.contract?.successCriteria ?? input.planSteps.map((step) => step.title);
  return [
    {
      id: "inspect_context",
      kind: "inspect",
      title: "Inspect context",
      objective: "Read only the files or artifacts needed to answer the objective.",
      phase: "exploration",
      ownerRole: "explorer",
      expectedOutputs: [output("context", "context_summary", "Evidence-backed context summary")],
      stopIfFails: true,
      acceptanceCriteria: criteria
    },
    {
      id: "summarize_findings",
      kind: "summarize",
      title: "Summarize findings",
      objective: "Return a bounded answer without writing files, applying patches, or running mutation tools.",
      phase: "summary",
      ownerRole: "summarizer",
      dependsOn: ["inspect_context"],
      requiredInputs: [evidence("file", "context_summary", "Read-only context summary", true)],
      expectedOutputs: [output("summary", "final_answer", "Final read-only answer")],
      stopIfFails: true,
      acceptanceCriteria: criteria
    }
  ];
}

function askUserSpecs(input: BuildTaskGraphFromContractInput): NodeSpec[] {
  return [
    {
      id: "clarify_objective",
      kind: "ask_user",
      title: "Ask for clarification",
      objective: "Ask the user for the missing decision required before execution.",
      phase: "planning",
      ownerRole: "planner",
      expectedOutputs: [output("summary", "clarifying_question", "Clarifying question")],
      stopIfFails: true,
      acceptanceCriteria: input.contract?.successCriteria ?? ["User receives a clear question"]
    }
  ];
}

function patchSpecs(input: BuildTaskGraphFromContractInput): NodeSpec[] {
  const criteria = input.contract?.successCriteria ?? input.planSteps.map((step) => step.title);
  return [
    {
      id: "inspect_context",
      kind: "inspect",
      title: "Inspect context",
      objective: "Select and read the relevant files before editing.",
      phase: "exploration",
      ownerRole: "explorer",
      expectedOutputs: [output("context", "context_summary", "Selected files and context summary")],
      stopIfFails: true,
      acceptanceCriteria: criteria
    },
    {
      id: "design_patch",
      kind: "design",
      title: "Design patch",
      objective: "Translate the objective and context into a narrow implementation plan.",
      phase: "planning",
      ownerRole: "planner",
      dependsOn: ["inspect_context"],
      requiredInputs: [evidence("file", "context_summary", "Selected code context", true)],
      expectedOutputs: [output("plan", "patch_design", "Patch design")],
      stopIfFails: true,
      acceptanceCriteria: criteria
    },
    {
      id: "produce_patch",
      kind: "patch",
      title: "Produce patch candidate",
      objective: "Generate one or more candidate diffs without applying them.",
      phase: "coding",
      ownerRole: "coder_a",
      dependsOn: ["design_patch"],
      requiredInputs: [evidence("reasoning", "patch_design", "Patch design", true)],
      expectedOutputs: [output("patch", "patch_candidate", "Patch candidate diff")],
      mutationAllowed: false,
      canRunInParallel: input.policy?.planningPolicy.allowParallelRoles !== false,
      stopIfFails: true,
      acceptanceCriteria: criteria
    },
    {
      id: "review_patch",
      kind: "review",
      title: "Review patch",
      objective: "Review candidate correctness, risk, regressions, and evidence coverage.",
      phase: "review",
      ownerRole: "reviewer",
      dependsOn: ["produce_patch"],
      requiredInputs: [evidence("diff", "patch_candidate", "Patch candidate diff", true)],
      expectedOutputs: [output("review", "review_decision", "Review report")],
      stopIfFails: true,
      acceptanceCriteria: criteria
    },
    {
      id: "judge_patch",
      kind: "judge",
      title: "Judge patch",
      objective: "Select, revise, ask the user, or abort based on review evidence.",
      phase: "judge",
      ownerRole: "judge",
      dependsOn: ["review_patch"],
      requiredInputs: [
        evidence("diff", "patch_candidate", "Patch candidate diff", true),
        evidence("review", "review_decision", "Review report", true)
      ],
      expectedOutputs: [output("judgment", "judge_decision", "Judge decision")],
      stopIfFails: true,
      acceptanceCriteria: criteria
    },
    {
      id: "apply_patch",
      kind: "apply_patch",
      title: "Apply selected patch",
      objective: "Apply only the candidate selected by the judge.",
      phase: "patch",
      ownerRole: "runner",
      dependsOn: ["judge_patch"],
      requiredInputs: [evidence("judge", "judge_decision", "Selected judge decision", true)],
      expectedOutputs: [output("artifact", "patch_apply", "Patch apply result")],
      mutationAllowed: true,
      stopIfFails: true,
      acceptanceCriteria: criteria
    },
    {
      id: "verify_patch",
      kind: "verify",
      title: "Verify patch",
      objective: input.verificationCommands?.join("; ") || "Run the configured verifier or record why verification is not available.",
      phase: "verification",
      ownerRole: "runner",
      dependsOn: ["apply_patch"],
      requiredInputs: [evidence("artifact", "patch_apply", "Patch apply result", true)],
      expectedOutputs: [output("test_result", "test_evidence", "Verification result")],
      stopIfFails: false,
      acceptanceCriteria: criteria
    },
    {
      id: "summarize",
      kind: "summarize",
      title: "Summarize outcome",
      objective: "Summarize the patch, judgment, verification, and remaining risk.",
      phase: "summary",
      ownerRole: "summarizer",
      dependsOn: ["verify_patch"],
      requiredInputs: [evidence("shell", "test_evidence", "Verification result or explicit no-verifier note", false)],
      expectedOutputs: [output("summary", "final_summary", "Final summary")],
      stopIfFails: false,
      acceptanceCriteria: criteria
    }
  ];
}

function highRiskPatchSpecs(input: BuildTaskGraphFromContractInput): NodeSpec[] {
  const securityReview: NodeSpec = {
    id: "security_review",
    kind: "review",
    title: "Security and risk review",
    objective: "High-risk contracts require explicit risk, security, and regression review before judge.",
    phase: "review",
    ownerRole: "reviewer",
    dependsOn: ["produce_patch"],
    requiredInputs: [
      evidence("diff", "patch_candidate", "Patch candidate diff", true),
      evidence("reasoning", "risk_map", "Risk map", false)
    ],
    expectedOutputs: [output("review", "review_decision", "Security review report")],
    stopIfFails: true,
    acceptanceCriteria: input.contract?.successCriteria ?? input.planSteps.map((step) => step.title)
  };
  const nodes: NodeSpec[] = [
    ...patchSpecs(input).filter((node) => node.id !== "review_patch"),
    securityReview
  ].map((node): NodeSpec => {
    if (node.id === "inspect_context") return node;
    if (node.id === "design_patch") return node;
    if (node.id === "produce_patch") return { ...node, dependsOn: ["design_patch", "risk_map"] };
    if (node.id === "judge_patch") return { ...node, dependsOn: ["security_review"] };
    return node;
  });
  const riskMapNode: NodeSpec = {
    id: "risk_map",
    kind: "analyze",
    title: "Map risk boundary",
    objective: "Identify files, permissions, commands, and invariants that make this task high risk.",
    phase: "planning",
    ownerRole: "planner",
    dependsOn: ["inspect_context"],
    requiredInputs: [evidence("file", "context_summary", "Selected code context", true)],
    expectedOutputs: [output("artifact", "risk_map", "Risk map")],
    stopIfFails: true,
    acceptanceCriteria: input.contract?.successCriteria ?? input.planSteps.map((step) => step.title)
  };
  nodes.splice(1, 0, riskMapNode);
  return nodes;
}

function repairLoopSpecs(input: BuildTaskGraphFromContractInput): NodeSpec[] {
  const criteria = input.contract?.successCriteria ?? ["Repair verifier failure"];
  return [
    {
      id: "verify_failed",
      kind: "verify",
      title: "Capture failed verifier",
      objective: "Record the failed command output that justifies a repair attempt.",
      phase: "verification",
      ownerRole: "runner",
      expectedOutputs: [output("test_result", "failed_verifier", "Failed verifier output")],
      stopIfFails: true,
      acceptanceCriteria: criteria
    },
    {
      id: "diagnose_failure",
      kind: "analyze",
      title: "Diagnose failure",
      objective: "Explain the minimal repair target from failed verifier evidence.",
      phase: "repair",
      ownerRole: "repairer",
      dependsOn: ["verify_failed"],
      requiredInputs: [evidence("shell", "failed_verifier", "Failed verifier output", true)],
      expectedOutputs: [output("artifact", "repair_diagnosis", "Repair diagnosis")],
      stopIfFails: true,
      acceptanceCriteria: criteria
    },
    {
      id: "produce_repair",
      kind: "repair",
      title: "Produce repair patch",
      objective: "Generate a repair patch candidate.",
      phase: "repair",
      ownerRole: "repairer",
      dependsOn: ["diagnose_failure"],
      requiredInputs: [evidence("reasoning", "repair_diagnosis", "Repair diagnosis", true)],
      expectedOutputs: [output("patch", "repair_patch", "Repair patch")],
      mutationAllowed: false,
      stopIfFails: true,
      acceptanceCriteria: criteria
    },
    {
      id: "review_repair",
      kind: "review",
      title: "Review repair",
      objective: "Review the repair patch before applying it.",
      phase: "review",
      ownerRole: "reviewer",
      dependsOn: ["produce_repair"],
      requiredInputs: [evidence("diff", "repair_patch", "Repair patch", true)],
      expectedOutputs: [output("review", "review_decision", "Repair review")],
      stopIfFails: true,
      acceptanceCriteria: criteria
    },
    {
      id: "apply_repair",
      kind: "apply_patch",
      title: "Apply repair",
      objective: "Apply the reviewed repair patch.",
      phase: "repair",
      ownerRole: "runner",
      dependsOn: ["review_repair"],
      requiredInputs: [evidence("review", "review_decision", "Repair review", true)],
      expectedOutputs: [output("artifact", "patch_apply", "Repair apply result")],
      mutationAllowed: true,
      stopIfFails: true,
      acceptanceCriteria: criteria
    },
    {
      id: "verify_repair",
      kind: "verify",
      title: "Verify repair",
      objective: input.verificationCommands?.join("; ") || "Run the failed verifier after repair.",
      phase: "verification",
      ownerRole: "runner",
      dependsOn: ["apply_repair"],
      requiredInputs: [evidence("artifact", "patch_apply", "Repair apply result", true)],
      expectedOutputs: [output("test_result", "test_evidence", "Repair verification")],
      stopIfFails: false,
      acceptanceCriteria: criteria
    }
  ];
}

function materializeNode(spec: NodeSpec, input: BuildTaskGraphFromContractInput, graphRisk: RiskLevel): TaskGraphNode {
  const dependsOn = spec.dependsOn ?? [];
  const requiredInputs = spec.requiredInputs ?? [];
  const expectedOutputs = spec.expectedOutputs ?? [];
  return {
    id: sanitizeNodeId(spec.id),
    kind: spec.kind,
    title: spec.title,
    objective: spec.objective,
    detail: spec.objective,
    phase: spec.phase,
    ownerRole: spec.ownerRole,
    roleHints: [spec.ownerRole],
    dependsOn: dependsOn.map(sanitizeNodeId),
    dependencies: dependsOn.map(sanitizeNodeId),
    requiredInputs,
    expectedOutputs,
    requiredEvidence: requiredInputs.map((item) => item.description),
    expectedArtifacts: expectedOutputs.map((item) => item.description),
    files: spec.files,
    riskLevel: spec.riskLevel ?? graphRisk,
    mutationAllowed: spec.mutationAllowed ?? false,
    canRunInParallel: spec.canRunInParallel ?? false,
    stopIfFails: spec.stopIfFails ?? true,
    fallbackRole: spec.fallbackRole,
    acceptanceCriteria: spec.acceptanceCriteria ?? input.contract?.successCriteria ?? [],
    status: spec.status ?? "pending"
  };
}

function evidence(kind: EvidenceRequirement["kind"], id: string, description: string, required: boolean): EvidenceRequirement {
  return { id, kind, description, required };
}

function output(kind: ExpectedOutput["kind"], id: string, description: string): ExpectedOutput {
  return { id, kind, description };
}

function stopConditionsForWorkflow(workflowKind: WorkflowKind): string[] {
  if (workflowKind === "read_only" || workflowKind === "advisory") return ["read-only deliverable complete"];
  if (workflowKind === "ask_user") return ["clarifying question delivered"];
  if (workflowKind === "repair") return ["repair verified or blocked"];
  return ["judge abort", "no patch candidate", "verification complete or explicitly unavailable"];
}

function riskBoundariesForWorkflow(workflowKind: WorkflowKind, riskLevel: RiskLevel, contract?: ObjectiveContractV1): string[] {
  return [
    `workflowKind=${workflowKind}`,
    `riskLevel=${riskLevel}`,
    ...(contract?.forbiddenActions.map((action) => `forbidden:${action}`) ?? []),
    ...(contract?.allowedTools.map((tool) => `allowedTool:${tool}`) ?? [])
  ];
}

function strongerRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  const rank: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
  return rank[b] >= rank[a] ? b : a;
}

function stableId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "default";
}

function sanitizeNodeId(value: string): string {
  return stableId(value) || "node";
}
