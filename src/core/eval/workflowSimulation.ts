import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TomorrowEdgeConfig } from "../../config/schema.js";
import { createProviderRegistry } from "../../providers/registry.js";
import type { ModelProvider } from "../../providers/types.js";
import { makeId } from "../../utils/ids.js";
import { estimateCostUsd, preflightBudget, summarizeModelUsage } from "../model/costAccounting.js";
import type { ModelBudgetStatus, ModelNote, ModelUsageSummary } from "../../schemas/modelNote.js";

export type WorkflowOptions = {
  providers?: string[];
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
  reportPath: string;
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

const maxWorkflowTokens = 900;

export async function runWorkflowSimulation(cwd: string, task: string, config: TomorrowEdgeConfig, options: WorkflowOptions = {}): Promise<WorkflowResult> {
  const id = makeId("workflow");
  const createdAt = new Date().toISOString();
  const corePlan = buildCorePlan(task);
  const registry = createProviderRegistry(config);
  const providers = selectProviders(registry.list(), options.providers);
  const context = await loadWorkflowContext(cwd);
  const maxRounds = normalizeRounds(options.rounds ?? config.debate.max_rounds);
  const debate: WorkflowTurn[] = [];
  let budgetStatus: ModelBudgetStatus = emptyBudgetStatus(config.debate.max_cost_usd);
  let spentKnownUsd = 0;

  for (let round = 1; round <= maxRounds; round += 1) {
    const debatePlans = buildDebatePlans(corePlan, context, providers, debate, round);
    const preflight = preflightWorkflowBatch(debatePlans, config.debate.max_cost_usd, spentKnownUsd);
    budgetStatus = preflight.status;
    if (budgetStatus.status === "blocked") break;
    const turns = await Promise.all(debatePlans.map((plan) => askProvider(plan.provider, "debate", round, plan.role, plan.prompt)));
    debate.push(...turns);
    spentKnownUsd += sumKnownCost(turns);
  }

  const assignments = buildAssignments(providers);
  const executionContext = [renderCorePlan(corePlan), renderTurns(debate)].join("\n\n");
  const executionPlans = buildExecutionPlans(corePlan, executionContext, providers);
  let executions: WorkflowTurn[] = [];
  if (budgetStatus.status !== "blocked") {
    const preflight = preflightWorkflowBatch(executionPlans, config.debate.max_cost_usd, spentKnownUsd);
    budgetStatus = preflight.status;
    if (budgetStatus.status !== "blocked") {
      executions = await Promise.all(executionPlans.map((plan) => askProvider(plan.provider, "execution", maxRounds + 1, plan.role, plan.prompt)));
      spentKnownUsd += sumKnownCost(executions);
    }
  }

  const review = coreReview(corePlan, debate, executions, budgetStatus);
  const usageSummary = summarizeModelUsage([...debate, ...executions].map(turnToNote));
  const report = renderWorkflowReport({ id, task, createdAt, corePlan, debate, assignments, executions, review, usageSummary, budgetStatus, debateRounds: maxRounds, reportPath: "" });
  const reportPath = await saveWorkflowReport(cwd, id, report);

  return {
    id,
    task,
    createdAt,
    corePlan,
    debate,
    assignments,
    executions,
    review,
    usageSummary,
    budgetStatus,
    debateRounds: maxRounds,
    reportPath
  };
}

function buildCorePlan(task: string): CorePlan {
  return {
    objective: task,
    decomposition: [
      "Clarify the product outcome and acceptance criteria.",
      "Debate implementation route, safety gates, and model-agent responsibilities.",
      "Assign implementation, docs/UX, and final judge roles to different providers.",
      "Collect non-mutating deliverables from each role.",
      "Core reviewer audits completeness, contradictions, and delivery readiness."
    ],
    agentRoles: [
      { role: "Core Planner/Reviewer", providerPreference: "river/local", responsibility: "Own plan, rubric, safety gates, and final delivery decision." },
      { role: "Architect/Judge", providerPreference: "openrouter", responsibility: "Stress-test the workflow, risks, and approval boundaries." },
      { role: "Implementation Agent", providerPreference: "deepseek", responsibility: "Turn the plan into concrete implementation steps and test strategy." },
      { role: "Docs/UX Agent", providerPreference: "mimo", responsibility: "Shape Chinese-default operator UX, docs, and handoff copy." }
    ],
    acceptanceCriteria: [
      "Workflow contains a visible debate phase before execution.",
      "Different providers receive distinct roles and deliverables.",
      "Execution outputs are non-mutating unless separately approved.",
      "Core reviewer identifies strengths, gaps, and delivery status.",
      "Report is saved for replay and audit."
    ],
    safetyRules: [
      "Do not apply patches during workflow simulation.",
      "Do not run shell commands proposed by models.",
      "Do not expose secrets or ignored files.",
      "Treat model output as advisory until Core review."
    ]
  };
}

function selectProviders(providers: ModelProvider[], requested?: string[]): { openrouter?: ModelProvider; deepseek?: ModelProvider; mimo?: ModelProvider } {
  const selected = new Map(providers.map((provider) => [provider.id, provider]));
  const allowed = requested?.length ? new Set(requested) : undefined;
  if (allowed?.has("mock")) {
    const mock = selected.get("mock");
    return { openrouter: mock, deepseek: mock, mimo: mock };
  }
  return {
    openrouter: (!allowed || allowed.has("openrouter")) ? selected.get("openrouter") : undefined,
    deepseek: (!allowed || allowed.has("deepseek")) ? selected.get("deepseek") : undefined,
    mimo: (!allowed || allowed.has("mimo")) ? selected.get("mimo") : undefined
  };
}

async function askProvider(provider: ModelProvider | undefined, phase: WorkflowTurn["phase"], round: number, role: string, prompt: string): Promise<WorkflowTurn> {
  if (!provider) {
    return { phase, round, role, provider: "unavailable", model: "unavailable", prompt, content: "", error: "Provider unavailable or not selected." };
  }
  const [model] = await provider.listModels();
  const modelId = model?.id ?? "configured-model";
  try {
    const response = await provider.chat({
      model: modelId,
      messages: [
        {
          role: "system",
          content:
            "You are participating in a multi-model coding-agent cockpit workflow. Be concrete, concise, and safety-aware. Do not claim that you changed files. Return plain text."
        },
        { role: "user", content: prompt }
      ],
      temperature: phase === "debate" ? 0.35 : 0.2,
      maxCompletionTokens: maxWorkflowTokens
    });
    return {
      phase,
      round,
      role,
      provider: provider.id,
      model: modelId,
      prompt,
      content: response.content.trim(),
      usage: response.usage,
      estimatedCostUsd: estimateCostUsd(provider.id, response.usage)
    };
  } catch (error) {
    return { phase, round, role, provider: provider.id, model: modelId, prompt, content: "", error: error instanceof Error ? error.message : String(error) };
  }
}

async function loadWorkflowContext(cwd: string): Promise<string> {
  const files = ["README.md", "docs/SCOPE_STATUS.md", "docs/ROUTING.md", "docs/SAFETY.md"];
  const chunks = await Promise.all(
    files.map(async (file) => {
      const content = await readFile(path.join(cwd, file), "utf8").catch(() => "");
      return `FILE: ${file}\n${content.slice(0, 1800)}`;
    })
  );
  return chunks.join("\n\n---\n\n");
}

type WorkflowCallPlan = {
  provider?: ModelProvider;
  role: string;
  prompt: string;
  maxOutputTokens: number;
};

function buildDebatePlans(
  plan: CorePlan,
  context: string,
  providers: { openrouter?: ModelProvider; deepseek?: ModelProvider; mimo?: ModelProvider },
  priorDebate: WorkflowTurn[],
  round: number
): WorkflowCallPlan[] {
  if (round === 1) {
    return [
      {
        provider: providers.openrouter,
        role: "Architect/Judge",
        prompt: buildDebatePrompt(plan, context, "challenge the plan, agent graph, and approval boundaries"),
        maxOutputTokens: maxWorkflowTokens
      },
      {
        provider: providers.deepseek,
        role: "Implementer",
        prompt: buildDebatePrompt(plan, context, "argue for the concrete implementation path and likely code risks"),
        maxOutputTokens: maxWorkflowTokens
      },
      {
        provider: providers.mimo,
        role: "Docs/Localization",
        prompt: buildDebatePrompt(plan, context, "argue for Chinese UX, docs, and developer ergonomics"),
        maxOutputTokens: maxWorkflowTokens
      }
    ];
  }

  const transcript = renderTurns(priorDebate);
  return [
    {
      provider: providers.openrouter,
      role: "Architect/Judge",
      prompt: buildCrossExaminationPrompt(plan, transcript, "identify contradictions in implementation and docs proposals; decide what needs Core approval"),
      maxOutputTokens: maxWorkflowTokens
    },
    {
      provider: providers.deepseek,
      role: "Implementer",
      prompt: buildCrossExaminationPrompt(plan, transcript, "respond to risks raised by other agents and refine the landing sequence"),
      maxOutputTokens: maxWorkflowTokens
    },
    {
      provider: providers.mimo,
      role: "Docs/Localization",
      prompt: buildCrossExaminationPrompt(plan, transcript, "challenge unclear Chinese operator UX and propose concise cockpit copy"),
      maxOutputTokens: maxWorkflowTokens
    }
  ];
}

function buildExecutionPlans(plan: CorePlan, context: string, providers: { openrouter?: ModelProvider; deepseek?: ModelProvider; mimo?: ModelProvider }): WorkflowCallPlan[] {
  return [
    {
      provider: providers.deepseek,
      role: "Implementation Agent",
      prompt: buildExecutionPrompt(plan, context, "Produce a concise implementation patch plan and test strategy. Do not claim files were changed."),
      maxOutputTokens: maxWorkflowTokens
    },
    {
      provider: providers.mimo,
      role: "Docs and UX Agent",
      prompt: buildExecutionPrompt(plan, context, "Produce Chinese-facing TUI copy, docs wording, and operator workflow notes."),
      maxOutputTokens: maxWorkflowTokens
    },
    {
      provider: providers.openrouter,
      role: "Final Judge Agent",
      prompt: buildExecutionPrompt(plan, context, "Review the other roles' expected outputs and name approval gates before delivery."),
      maxOutputTokens: maxWorkflowTokens
    }
  ];
}

function buildDebatePrompt(plan: CorePlan, context: string, instruction: string): string {
  return [renderCorePlan(plan), `Your debate instruction: ${instruction}`, "Project context:", context].join("\n\n");
}

function buildCrossExaminationPrompt(plan: CorePlan, transcript: string, instruction: string): string {
  return [renderCorePlan(plan), "Prior debate transcript:", transcript || "No prior transcript.", `Cross-examination instruction: ${instruction}`, "Keep the answer short and actionable."].join("\n\n");
}

function buildExecutionPrompt(plan: CorePlan, context: string, instruction: string): string {
  return [renderCorePlan(plan), "Debate transcript:", context, `Execution instruction: ${instruction}`].join("\n\n");
}

function preflightWorkflowBatch(plans: WorkflowCallPlan[], maxCostUsd: number, spentKnownUsd: number): { status: ModelBudgetStatus } {
  const remaining = Math.max(0, maxCostUsd - spentKnownUsd);
  const status = preflightBudget(
    plans
      .filter((plan) => plan.provider)
      .map((plan) => ({ provider: plan.provider!.id, prompt: plan.prompt, maxOutputTokens: plan.maxOutputTokens })),
    remaining
  );
  if (status.status === "blocked") {
    return {
      status: {
        ...status,
        maxCostUsd,
        reason: `Workflow live model budget blocked: ${status.reason}`
      }
    };
  }
  return {
    status: {
      ...status,
      maxCostUsd
    }
  };
}

function buildAssignments(providers: { openrouter?: ModelProvider; deepseek?: ModelProvider; mimo?: ModelProvider }): WorkflowAssignment[] {
  return [
    { role: "Architect/Judge", provider: providers.openrouter?.id ?? "unavailable", deliverable: "Risk critique, approval gate review, final judge notes." },
    { role: "Implementation Agent", provider: providers.deepseek?.id ?? "unavailable", deliverable: "Implementation patch plan and test strategy." },
    { role: "Docs/UX Agent", provider: providers.mimo?.id ?? "unavailable", deliverable: "Chinese UX copy, docs updates, operator workflow notes." }
  ];
}

function coreReview(plan: CorePlan, debate: WorkflowTurn[], executions: WorkflowTurn[], budgetStatus: ModelBudgetStatus): CoreReview {
  const allTurns = [...debate, ...executions];
  const completed = allTurns.filter((turn) => turn.content && !turn.error);
  const gaps = allTurns.filter((turn) => turn.error || !turn.content).map((turn) => `${turn.role}/${turn.provider}: ${turn.error ?? "empty output"}`);
  if (!allTurns.length) gaps.push("No model turns ran.");
  if (budgetStatus.status === "blocked") gaps.push(budgetStatus.reason);
  const strengths = [
    `${completed.length}/${allTurns.length} model turns produced usable content.`,
    "Workflow includes explicit debate before execution.",
    "Execution deliverables remain non-mutating and reviewable."
  ];
  if (executions.some((turn) => /test|verify|验证/i.test(turn.content))) strengths.push("At least one execution agent addressed verification.");
  if (debate.some((turn) => /risk|approval|安全|授权/i.test(turn.content))) strengths.push("Debate raised risk or approval concerns.");
  return {
    verdict: gaps.length ? "needs_revision" : "accepted",
    strengths,
    gaps,
    deliverySummary: gaps.length
      ? `Workflow for "${plan.objective}" needs revision because some role outputs were unavailable.`
      : `Workflow for "${plan.objective}" is accepted as a complete non-mutating orchestration drill.`
  };
}

function turnToNote(turn: WorkflowTurn): ModelNote {
  return {
    id: makeId(`workflow_${turn.provider}`),
    role: turn.role === "Implementation Agent" ? "coder_a" : turn.role === "Final Judge Agent" ? "judge" : "reviewer",
    provider: turn.provider,
    model: turn.model,
    kind: turn.phase === "execution" ? "implementation_advice" : "review_advice",
    content: turn.content,
    usage: turn.usage,
    estimatedCostUsd: turn.estimatedCostUsd,
    error: turn.error
  };
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
  return turns.map((turn) => `## ${turn.phase} round ${turn.round}: ${turn.role} via ${turn.provider}/${turn.model}\n${turn.error ? `ERROR: ${turn.error}` : turn.content}`).join("\n\n");
}

function renderWorkflowReport(result: WorkflowResult): string {
  return [
    `# Workflow ${result.id}`,
    `Task: ${result.task}`,
    `Created: ${result.createdAt}`,
    `Debate rounds requested: ${result.debateRounds}`,
    `Budget: ${result.budgetStatus.status} (${result.budgetStatus.reason})`,
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

function normalizeRounds(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(5, Math.max(1, Math.trunc(value)));
}

function emptyBudgetStatus(maxCostUsd: number): ModelBudgetStatus {
  return {
    status: "within_budget",
    maxCostUsd,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    estimatedCostUsd: 0,
    reason: "No live workflow batch has been preflighted yet."
  };
}

function sumKnownCost(turns: WorkflowTurn[]): number {
  return turns.reduce((sum, turn) => sum + (turn.estimatedCostUsd ?? 0), 0);
}

async function saveWorkflowReport(cwd: string, id: string, content: string): Promise<string> {
  const dir = path.join(cwd, ".tomorrowedge", "workflows");
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.md`);
  await writeFile(filePath, content, "utf8");
  return filePath;
}
