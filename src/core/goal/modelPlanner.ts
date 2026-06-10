import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { Plan, PlanStep, RiskLevel, TaskType } from "../../schemas/plan.js";
import { chatWithProviderFallback } from "../model/providerFallback.js";
import type { EventLedger } from "../events/eventLedger.js";
import type { ModelRouter } from "../routing/router.js";
import { buildTaskGraph } from "../planning/taskGraphBuilder.js";
import { parseTaskGraphCandidate } from "../planning/taskGraphValidator.js";

export async function createModelBackedPlan(input: {
  goal: string;
  config: TomorrowEdgeConfig;
  router: ModelRouter;
  ledger: EventLedger;
  localOnly?: boolean;
}): Promise<{ plan?: Plan; provider: string; model: string; fallbackUsed?: boolean; error?: string }> {
  const assignment = input.localOnly ? { provider: "mock", model: "mock-balanced" } : input.router.assignmentFor("planner");
  const result = await chatWithProviderFallback({
    config: input.config,
    router: input.router,
    role: "planner",
    provider: assignment.provider,
    model: assignment.model,
    ledger: input.ledger,
    buildRequest: (model) => ({
      model,
      temperature: 0.1,
      maxCompletionTokens: 900,
      responseFormat: { type: "json_object" },
      metadata: { tomorrowedgeTask: "planner_plan" },
      messages: [
        {
          role: "system",
          content: [
            "You are TomorrowEdge's Planner.",
            "Create a structured engineering workflow plan for a multi-agent coding cockpit.",
            "Return strict JSON only with keys: taskType, riskLevel, constraints, steps, taskGraph, verificationCommands, debateRecommended, reasonForDebate.",
            "taskType must be one of: bugfix, feature, refactor, test, docs, analysis, unknown.",
            "riskLevel must be one of: low, medium, high.",
            "steps must be an array of objects with id, title, detail. Use a variable number of task-specific steps.",
            "taskGraph should contain nodes with id, title, detail, phase, roleHints, dependencies, requiredEvidence, expectedArtifacts.",
            "Use analysis for read-only inspection requests and avoid patch/test commands for analysis tasks."
          ].join("\n")
        },
        { role: "user", content: `Goal:\n${input.goal}` }
      ]
    })
  });
  const plan = parsePlannerResponse(input.goal, result.response?.content);
  return {
    plan,
    provider: result.response ? result.provider : assignment.provider,
    model: result.response ? result.model : assignment.model,
    fallbackUsed: result.fallbackUsed || !plan,
    error: plan ? undefined : result.error ?? "planner model returned an invalid plan"
  };
}

export function parsePlannerResponse(goal: string, content?: string): Plan | undefined {
  if (!content) return undefined;
  const object = parseJsonObject(content);
  if (!object) return undefined;
  const taskType = parseTaskType(object.taskType);
  const riskLevel = parseRiskLevel(object.riskLevel);
  const steps = parseSteps(object.steps);
  if (!taskType || !riskLevel || !steps.length) return undefined;
  const constraints = Array.isArray(object.constraints) ? object.constraints.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
  const verificationCommands = Array.isArray(object.verificationCommands)
    ? object.verificationCommands.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
    : undefined;
  return {
    goal,
    taskType,
    riskLevel,
    constraints,
    steps,
    taskGraph: parseTaskGraphCandidate(object.taskGraph) ?? buildTaskGraph({
      plan: {
        goal,
        taskType,
        riskLevel,
        constraints,
        steps,
        verificationCommands,
        debateRecommended: typeof object.debateRecommended === "boolean" ? object.debateRecommended : riskLevel === "high",
        reasonForDebate: typeof object.reasonForDebate === "string" && object.reasonForDebate.trim() ? object.reasonForDebate.trim() : undefined
      }
    }),
    verificationCommands,
    debateRecommended: typeof object.debateRecommended === "boolean" ? object.debateRecommended : riskLevel === "high",
    reasonForDebate: typeof object.reasonForDebate === "string" && object.reasonForDebate.trim() ? object.reasonForDebate.trim() : undefined
  };
}

function parseJsonObject(content: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    const match = /\{[\s\S]*\}/.exec(content);
    if (!match) return undefined;
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
    } catch {
      return undefined;
    }
  }
}

function parseTaskType(value: unknown): TaskType | undefined {
  return value === "bugfix" || value === "feature" || value === "refactor" || value === "test" || value === "docs" || value === "analysis" || value === "unknown" ? value : undefined;
}

function parseRiskLevel(value: unknown): RiskLevel | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

function parseSteps(value: unknown): PlanStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const detail = typeof record.detail === "string" ? record.detail.trim() : "";
    if (!title || !detail) return [];
    const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : `step-${index + 1}`;
    return [{ id, title, detail, status: index === 0 ? "done" as const : "pending" as const }];
  });
}
