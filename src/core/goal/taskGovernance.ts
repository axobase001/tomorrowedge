import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { Plan } from "../../schemas/plan.js";
import { chatWithProviderFallback } from "../model/providerFallback.js";
import { structuredJsonResponseFormat, taskGovernanceResponseSchema } from "../model/structuredOutput.js";
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
    throw new Error("Governance model call blocked before invocation; no local semantic fallback will be used.");
  }
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
    buildRequest: (model, provider) => ({
      model,
      temperature: 0,
      maxCompletionTokens: 360,
      responseFormat: structuredJsonResponseFormat(provider, "tomorrowedge_task_governance", taskGovernanceResponseSchema),
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
  const repaired = !parsed && result.response?.content && !input.localOnly
    ? await repairTaskGovernanceResponse({
        ...input,
        provider: result.provider,
        model: result.model,
        originalContent: result.response.content
      })
    : undefined;
  const decision = parsed ?? repaired?.decision;
  if (!decision) {
    const repairError = result.error ?? repaired?.error;
    throw new Error(`Governance model returned no valid semantic decision; no local fallback will be used.${repairError ? ` ${repairError}` : ""}`);
  }
  return {
    ...decision,
    provider: repaired?.decision ? repaired.provider : result.provider,
    model: repaired?.decision ? repaired.model : result.model,
    fallbackUsed: false
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

async function repairTaskGovernanceResponse(input: {
  goal: string;
  plan: Plan;
  workflowIntent: WorkflowIntentDecision;
  config: TomorrowEdgeConfig;
  router: ModelRouter;
  ledger: EventLedger;
  localOnly?: boolean;
  modelDisabled?: boolean;
  provider: string;
  model: string;
  originalContent: string;
}): Promise<{ decision?: Omit<TaskGovernanceDecision, "provider" | "model" | "fallbackUsed">; provider: string; model: string; error?: string }> {
  input.ledger.append({
    type: "evidence_update",
    phase: "planning",
    role: "planner",
    provider: input.provider,
    model: input.model,
    evidence: ["task governance output invalid; requesting same-model structured JSON repair"]
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
    buildRequest: (model, provider) => ({
      model,
      temperature: 0,
      maxCompletionTokens: 320,
      responseFormat: structuredJsonResponseFormat(provider, "tomorrowedge_task_governance_repair", taskGovernanceResponseSchema),
      metadata: { tomorrowedgeTask: "task_governance_repair" },
      messages: [
        {
          role: "system",
          content: [
            "Repair TomorrowEdge task governance output into one valid JSON object.",
            "Return JSON only. No markdown.",
            "Required keys: reasoningSensitivity, requiresReviewer, requiresJudge, confidence, reason."
          ].join("\n")
        },
        {
          role: "user",
          content: [
            `User request:\n${input.goal}`,
            `Workflow intent: ${input.workflowIntent.intent}, requiresPatchWorkflow=${input.workflowIntent.requiresPatchWorkflow}`,
            `Planner taskType: ${input.plan.taskType}, riskLevel=${input.plan.riskLevel}`,
            "",
            "Invalid previous output:",
            input.originalContent.slice(0, 4000)
          ].join("\n")
        }
      ]
    })
  });
  const decision = parseTaskGovernanceResponse(result.response?.content);
  return {
    decision,
    provider: result.response ? result.provider : input.provider,
    model: result.response ? result.model : input.model,
    error: decision ? undefined : result.error ?? "task governance repair returned invalid JSON"
  };
}

function parseReasoningSensitivity(value: unknown): ReasoningSensitivity | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

function clampConfidence(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.max(0, Math.min(1, number));
}
