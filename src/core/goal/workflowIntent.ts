import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { Plan } from "../../schemas/plan.js";
import { chatWithProviderFallback } from "../model/providerFallback.js";
import type { ModelRouter } from "../routing/router.js";
import type { EventLedger } from "../events/eventLedger.js";

export type WorkflowIntentKind = "inspect" | "patch" | "ask_user";

export type WorkflowIntentDecision = {
  intent: WorkflowIntentKind;
  requiresPatchWorkflow: boolean;
  confidence: number;
  reason: string;
  provider: string;
  model: string;
  fallbackUsed?: boolean;
};

export async function classifyWorkflowIntent(input: {
  goal: string;
  config: TomorrowEdgeConfig;
  router: ModelRouter;
  ledger: EventLedger;
  fixtureMode?: boolean;
  localOnly?: boolean;
}): Promise<WorkflowIntentDecision> {
  const assignment = input.fixtureMode || input.localOnly ? { provider: "mock", model: "mock-balanced" } : input.router.assignmentFor("planner");
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
      maxCompletionTokens: 300,
      responseFormat: { type: "json_object" },
      metadata: { tomorrowedgeTask: "workflow_intent" },
      messages: [
        {
          role: "system",
          content: [
            "You are TomorrowEdge's workflow intent router.",
            "Classify whether a user command should enter a code patch workflow.",
            "Return strict JSON only with keys: intent, requiresPatchWorkflow, confidence, reason.",
            "intent must be one of: inspect, patch, ask_user.",
            "Use inspect for read-only requests such as listing files, reading directory structure, summarizing existing content, or answering from available context.",
            "Use patch for tasks that ask to create, modify, fix, delete, refactor, implement, test, or otherwise change files.",
            "Use ask_user only when the command is too ambiguous to decide safely."
          ].join("\n")
        },
        {
          role: "user",
          content: `User command:\n${input.goal}`
        }
      ]
    })
  });
  const parsed = parseIntentResponse(result.response?.content);
  const decision = parsed ?? conservativeFallback(input.goal, result.error);
  return {
    ...decision,
    provider: result.response ? result.provider : "local_intent_fallback",
    model: result.response ? result.model : "conservative",
    fallbackUsed: result.fallbackUsed || !parsed
  };
}

export function applyWorkflowIntentToPlan(plan: Plan, decision: WorkflowIntentDecision): Plan {
  if (decision.requiresPatchWorkflow) return plan;
  return {
    ...plan,
    taskType: "analysis",
    verificationCommands: [],
    debateRecommended: false,
    reasonForDebate: undefined,
    steps: [
      { id: "understand", title: "Understand read-only request", detail: "Use model intent routing to avoid unnecessary patch workflow.", status: "done" },
      { id: "inspect", title: "Inspect local context", detail: "Read safe metadata or directory structure.", status: "pending" },
      { id: "summarize", title: "Summarize findings", detail: "Return evidence without patch, shell, or approval gates.", status: "pending" }
    ]
  };
}

function parseIntentResponse(content?: string): Omit<WorkflowIntentDecision, "provider" | "model" | "fallbackUsed"> | undefined {
  if (!content) return undefined;
  const object = parseJsonObject(content);
  if (!object) return undefined;
  const intent = object.intent;
  if (intent !== "inspect" && intent !== "patch" && intent !== "ask_user") return undefined;
  const requiresPatchWorkflow = typeof object.requiresPatchWorkflow === "boolean" ? object.requiresPatchWorkflow : intent === "patch";
  return {
    intent,
    requiresPatchWorkflow,
    confidence: clampConfidence(object.confidence),
    reason: typeof object.reason === "string" && object.reason.trim() ? object.reason.trim() : `Model classified workflow intent as ${intent}.`
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

function clampConfidence(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.max(0, Math.min(1, number));
}

function conservativeFallback(goal: string, error?: string): Omit<WorkflowIntentDecision, "provider" | "model" | "fallbackUsed"> {
  return {
    intent: "patch",
    requiresPatchWorkflow: true,
    confidence: 0.25,
    reason: `Intent model result was unavailable or invalid; defaulted to patch workflow for safety.${error ? ` ${error}` : ""}`
  };
}
