import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { Plan } from "../../schemas/plan.js";
import { chatWithProviderFallback } from "../model/providerFallback.js";
import type { EventLedger } from "../events/eventLedger.js";
import type { ModelRouter } from "../routing/router.js";
import type { WorkflowIntentDecision } from "./workflowIntent.js";

export type ReasoningSensitivity = "low" | "medium" | "high";

export type TaskGovernanceDecision = {
  reasoningSensitivity: ReasoningSensitivity;
  requiresReviewer: boolean;
  requiresJudge: boolean;
  confidence: number;
  reason: string;
  provider: string;
  model: string;
  fallbackUsed?: boolean;
};

export async function classifyTaskGovernance(input: {
  goal: string;
  plan: Plan;
  workflowIntent: WorkflowIntentDecision;
  config: TomorrowEdgeConfig;
  router: ModelRouter;
  ledger: EventLedger;
  localOnly?: boolean;
  modelDisabled?: boolean;
}): Promise<TaskGovernanceDecision> {
  if (input.modelDisabled) {
    const decision = conservativeGovernanceFallback(input.plan, input.workflowIntent, "Governance model call blocked before invocation.");
    return {
      ...decision,
      provider: "local_governance_fallback",
      model: "conservative",
      fallbackUsed: true
    };
  }
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
      temperature: 0,
      maxCompletionTokens: 360,
      responseFormat: { type: "json_object" },
      metadata: { tomorrowedgeTask: "task_governance" },
      messages: [
        {
          role: "system",
          content: [
            "You are TomorrowEdge's task governance router.",
            "Decide whether this user request needs independent reviewer and judge roles before TomorrowEdge presents a final answer or patch.",
            "Do not decide by keyword matching. Interpret the semantic burden of correctness, reversibility, safety, and verification.",
            "Escalate when a single implementation/execution model should not be the final authority, including correctness-critical reasoning, formal arguments, security-sensitive changes, irreversible operations, benchmark/research claims, or tasks with unclear verification.",
            "Return strict JSON only with keys: reasoningSensitivity, requiresReviewer, requiresJudge, confidence, reason.",
            "reasoningSensitivity must be one of: low, medium, high."
          ].join("\n")
        },
        {
          role: "user",
          content: [
            `User request:\n${input.goal}`,
            "",
            `Workflow intent: ${input.workflowIntent.intent}, requiresPatchWorkflow=${input.workflowIntent.requiresPatchWorkflow}`,
            `Planner taskType: ${input.plan.taskType}, riskLevel=${input.plan.riskLevel}`,
            `Planner debateRecommended: ${Boolean(input.plan.debateRecommended)}`
          ].join("\n")
        }
      ]
    })
  });
  const parsed = parseTaskGovernanceResponse(result.response?.content);
  const decision = parsed ?? conservativeGovernanceFallback(input.plan, input.workflowIntent, result.error);
  return {
    ...decision,
    provider: result.response ? result.provider : "local_governance_fallback",
    model: result.response ? result.model : "conservative",
    fallbackUsed: result.fallbackUsed || !parsed
  };
}

export function parseTaskGovernanceResponse(content?: string): Omit<TaskGovernanceDecision, "provider" | "model" | "fallbackUsed"> | undefined {
  if (!content) return undefined;
  const object = parseJsonObject(content);
  if (!object) return undefined;
  const reasoningSensitivity = parseReasoningSensitivity(object.reasoningSensitivity);
  if (!reasoningSensitivity) return undefined;
  return {
    reasoningSensitivity,
    requiresReviewer: typeof object.requiresReviewer === "boolean" ? object.requiresReviewer : reasoningSensitivity !== "low",
    requiresJudge: typeof object.requiresJudge === "boolean" ? object.requiresJudge : reasoningSensitivity === "high",
    confidence: clampConfidence(object.confidence),
    reason: typeof object.reason === "string" && object.reason.trim() ? object.reason.trim() : `Governance model classified reasoning sensitivity as ${reasoningSensitivity}.`
  };
}

function conservativeGovernanceFallback(plan: Plan, workflowIntent: WorkflowIntentDecision, error?: string): Omit<TaskGovernanceDecision, "provider" | "model" | "fallbackUsed"> {
  const elevated = plan.riskLevel === "high" || Boolean(plan.debateRecommended) || workflowIntent.intent === "ask_user";
  return {
    reasoningSensitivity: elevated ? "medium" : "low",
    requiresReviewer: elevated,
    requiresJudge: plan.riskLevel === "high" || workflowIntent.intent === "ask_user",
    confidence: 0.35,
    reason: `Governance model unavailable; used conservative plan-level fallback.${error ? ` ${error}` : ""}`
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

function parseReasoningSensitivity(value: unknown): ReasoningSensitivity | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

function clampConfidence(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.max(0, Math.min(1, number));
}
