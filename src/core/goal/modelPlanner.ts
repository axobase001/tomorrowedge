import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { Plan, PlanStep, RiskLevel, TaskType } from "../../schemas/plan.js";
import { chatWithProviderFallback } from "../model/providerFallback.js";
import type { EventLedger } from "../events/eventLedger.js";
import type { ModelRouter } from "../routing/router.js";
import type { WorkflowKind } from "../orchestration/workflowKind.js";
import { buildTaskGraph } from "../planning/taskGraphBuilder.js";
import { parseTaskGraphCandidate } from "../planning/taskGraphValidator.js";

export const MODEL_PLANNER_MAX_COMPLETION_TOKENS = 2400;
const MODEL_PLANNER_REPAIR_MAX_COMPLETION_TOKENS = 1800;

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
    allowFallback: false,
    markProviderUnavailable: false,
    buildRequest: (model) => ({
      model,
      temperature: 0.1,
      maxCompletionTokens: MODEL_PLANNER_MAX_COMPLETION_TOKENS,
      responseFormat: { type: "json_object" },
      metadata: { tomorrowedgeTask: "planner_plan" },
      messages: [
        {
          role: "system",
          content: [
            "You are TomorrowEdge's Planner.",
            "Create a structured engineering workflow plan for a multi-agent coding cockpit.",
            "Return strict compact JSON only. No markdown, no prose before or after JSON.",
            "Use keys: taskType, riskLevel, workflowKind, constraints, steps, taskGraph, verificationCommands, debateRecommended, reasonForDebate.",
            "taskType must be one of: bugfix, feature, refactor, test, docs, analysis, unknown.",
            "riskLevel must be one of: low, medium, high.",
            "workflowKind must be one of: read_only, patch, repair, vision_patch, advisory, ask_user.",
            "steps must be 4-8 objects with id, title, detail. Keep each detail under 180 characters.",
            "Set taskGraph to null. TomorrowEdge will derive the executable TaskGraph from your steps.",
            "Do not include taskGraph nodes; keep the response small enough to finish.",
            "For patch workflows, the plan must cover inspect_context, design_patch, produce_patch, review_patch, judge_patch, apply_patch, verify_patch, summarize.",
            "For read_only workflows, cover inspect_context and summarize_findings only, with no mutationAllowed nodes.",
            "Use analysis for read-only inspection requests and avoid patch/test commands for analysis tasks."
          ].join("\n")
        },
        { role: "user", content: `Goal:\n${input.goal}` }
      ]
    })
  });
  const parsed = parsePlannerResponseWithDiagnostics(input.goal, result.response?.content);
  if (parsed.plan) {
    return {
      plan: parsed.plan,
      provider: result.response ? result.provider : assignment.provider,
      model: result.response ? result.model : assignment.model,
      fallbackUsed: result.fallbackUsed || false
    };
  }

  const repaired = result.response?.content
    ? await repairModelPlannerResponse({
        ...input,
        provider: result.provider,
        model: result.model,
        originalContent: result.response.content,
        parseError: parsed.error
      })
    : undefined;
  if (repaired?.plan) {
    return {
      plan: repaired.plan,
      provider: repaired.provider,
      model: repaired.model,
      fallbackUsed: false
    };
  }

  return {
    provider: result.response ? result.provider : assignment.provider,
    model: result.response ? result.model : assignment.model,
    fallbackUsed: result.fallbackUsed || false,
    error: result.error ?? repaired?.error ?? parsed.error ?? "planner model returned an invalid plan"
  };
}

export function parsePlannerResponse(goal: string, content?: string): Plan | undefined {
  return parsePlannerResponseWithDiagnostics(goal, content).plan;
}

export function parsePlannerResponseWithDiagnostics(goal: string, content?: string): { plan?: Plan; error?: string } {
  if (!content) return { error: "planner model returned empty content" };
  const objectResult = parseJsonObject(content);
  if (!objectResult.object) return { error: objectResult.error ?? "planner model returned invalid JSON" };
  const object = objectResult.object;
  const taskType = parseTaskType(object.taskType);
  const riskLevel = parseRiskLevel(object.riskLevel);
  const workflowKind = parseWorkflowKind(object.workflowKind);
  const steps = parseSteps(object.steps);
  if (!taskType) return { error: "planner model returned unsupported taskType" };
  if (!riskLevel) return { error: "planner model returned unsupported riskLevel" };
  if (!steps.length) return { error: "planner model returned no executable steps" };
  const constraints = Array.isArray(object.constraints) ? object.constraints.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
  const verificationCommands = Array.isArray(object.verificationCommands)
    ? object.verificationCommands.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
    : undefined;
  const plan = {
    goal,
    taskType,
    riskLevel,
    workflowKind,
    requiresPatchWorkflow: workflowKind ? !["read_only", "advisory", "ask_user"].includes(workflowKind) : undefined,
    constraints,
    steps,
    taskGraph: parseTaskGraphCandidate(object.taskGraph) ?? buildTaskGraph({
      plan: {
        goal,
        taskType,
        riskLevel,
        workflowKind,
        requiresPatchWorkflow: workflowKind ? !["read_only", "advisory", "ask_user"].includes(workflowKind) : undefined,
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
  } satisfies Plan;
  return { plan };
}

async function repairModelPlannerResponse(input: {
  goal: string;
  config: TomorrowEdgeConfig;
  router: ModelRouter;
  ledger: EventLedger;
  localOnly?: boolean;
  provider: string;
  model: string;
  originalContent: string;
  parseError?: string;
}): Promise<{ plan?: Plan; provider: string; model: string; error?: string }> {
  if (input.localOnly) return { provider: input.provider, model: input.model, error: input.parseError };
  input.ledger.append({
    type: "evidence_update",
    phase: "planning",
    role: "planner",
    provider: input.provider,
    model: input.model,
    evidence: [`planner output invalid: ${input.parseError ?? "unknown parse error"}`, "requesting same-model structured plan repair"]
  });
  const result = await chatWithProviderFallback({
    config: input.config,
    router: input.router,
    role: "planner",
    provider: input.provider,
    model: input.model,
    ledger: input.ledger,
    allowFallback: false,
    markProviderUnavailable: false,
    buildRequest: (model) => ({
      model,
      temperature: 0,
      maxCompletionTokens: MODEL_PLANNER_REPAIR_MAX_COMPLETION_TOKENS,
      responseFormat: { type: "json_object" },
      metadata: { tomorrowedgeTask: "planner_plan_repair" },
      messages: [
        {
          role: "system",
          content: [
            "You repair TomorrowEdge planner output into valid strict JSON.",
            "Return JSON only. No markdown. No commentary.",
            "Required keys: taskType, riskLevel, workflowKind, constraints, steps, taskGraph, verificationCommands, debateRecommended, reasonForDebate.",
            "Use 4-8 compact steps with id, title, detail. Each detail must be under 180 characters.",
            "Set taskGraph to null. Do not include taskGraph nodes.",
            "Preserve the user's objective and constraints. Do not solve the task or produce file contents."
          ].join("\n")
        },
        {
          role: "user",
          content: [
            `Goal:\n${input.goal}`,
            `Parse error:\n${input.parseError ?? "invalid planner JSON"}`,
            `Invalid planner output:\n${input.originalContent.slice(0, 6000)}`
          ].join("\n\n")
        }
      ]
    })
  });
  const parsed = parsePlannerResponseWithDiagnostics(input.goal, result.response?.content);
  return {
    plan: parsed.plan,
    provider: result.response ? result.provider : input.provider,
    model: result.response ? result.model : input.model,
    error: parsed.plan ? undefined : result.error ?? parsed.error ?? "planner repair returned invalid plan"
  };
}

function parseJsonObject(content: string): { object?: Record<string, unknown>; error?: string } {
  if (!content) return { error: "planner model returned empty content" };
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { object: parsed as Record<string, unknown> }
      : { error: "planner JSON root is not an object" };
  } catch (error) {
    const match = /\{[\s\S]*\}/.exec(content);
    if (!match) return { error: error instanceof Error ? error.message : "planner content is not JSON" };
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? { object: parsed as Record<string, unknown> }
        : { error: "planner JSON root is not an object" };
    } catch (innerError) {
      return { error: innerError instanceof Error ? innerError.message : "planner content is not valid JSON" };
    }
  }
}

function parseTaskType(value: unknown): TaskType | undefined {
  return value === "bugfix" || value === "feature" || value === "refactor" || value === "test" || value === "docs" || value === "analysis" || value === "unknown" ? value : undefined;
}

function parseRiskLevel(value: unknown): RiskLevel | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

function parseWorkflowKind(value: unknown): WorkflowKind | undefined {
  return value === "read_only" || value === "patch" || value === "repair" || value === "vision_patch" || value === "advisory" || value === "ask_user" ? value : undefined;
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
