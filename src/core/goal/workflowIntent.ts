import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { Plan } from "../../schemas/plan.js";
import type { WorkflowKind } from "../orchestration/workflowKind.js";
import { chatWithProviderFallback } from "../model/providerFallback.js";
import type { ModelRouter } from "../routing/router.js";
import type { EventLedger } from "../events/eventLedger.js";

export type WorkflowIntentKind = "inspect" | "patch" | "ask_user";

export type WorkflowIntentDecision = {
  intent: WorkflowIntentKind;
  requiresPatchWorkflow: boolean;
  workflowKind: WorkflowKind;
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
  const assignment = input.fixtureMode || input.localOnly
    ? { provider: "mock", model: "mock-balanced" }
    : input.router.assignmentFor("planner");
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
      temperature: 0,
      maxCompletionTokens: 300,
      responseFormat: { type: "json_object" },
      metadata: { tomorrowedgeTask: "workflow_intent" },
      messages: [
        {
          role: "system",
          content: [
            "You are TomorrowEdge's workflow intent router.",
            "Classify the user's request semantically. Do not use keyword matching.",
            "Return strict JSON only with keys: intent, requiresPatchWorkflow, workflowKind, confidence, reason.",
            "intent must be one of: inspect, patch, ask_user.",
            "workflowKind must be one of: read_only, patch, repair, vision_patch, advisory, ask_user.",
            "Use inspect/read_only for requests that only read, list, explain, summarize, inspect, answer, or review without changing files.",
            "Use patch for tasks that create, modify, fix, delete, refactor, implement, test, or otherwise change files.",
            "Use vision_patch for image/screenshot/design-to-code tasks.",
            "Use ask_user only when the request is too ambiguous to choose a safe workflow."
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
  const decision = parsed ?? modelIntentBlocked(result.error);
  return {
    ...decision,
    provider: result.provider,
    model: result.model,
    fallbackUsed: false
  };
}

export function applyWorkflowIntentToPlan(plan: Plan, decision: WorkflowIntentDecision): Plan {
  if (decision.requiresPatchWorkflow) {
    if (plan.taskType !== "analysis") return { ...plan, workflowKind: decision.workflowKind, requiresPatchWorkflow: true };
    return {
      ...plan,
      taskType: "unknown",
      workflowKind: decision.workflowKind,
      requiresPatchWorkflow: true,
      verificationCommands: plan.verificationCommands?.length ? plan.verificationCommands : ["npm test"],
      steps: [
        { id: "understand", title: "Understand task", detail: "Use model intent routing to preserve the requested patch workflow.", status: "done" },
        { id: "explore", title: "Explore repository", detail: "Find the smallest relevant context.", status: "pending" },
        { id: "propose", title: "Propose candidate patch", detail: "Generate one or more patch candidates.", status: "pending" },
        { id: "review", title: "Review candidate", detail: "Evaluate patch risk and evidence before judge selection.", status: "pending" },
        { id: "verify", title: "Verify", detail: "Run approved checks and gather evidence.", status: "pending" }
      ]
    };
  }
  return {
    ...plan,
    taskType: "analysis",
    workflowKind: decision.workflowKind,
    requiresPatchWorkflow: false,
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
  const workflowKind = parseWorkflowKind(object.workflowKind, requiresPatchWorkflow);
  return {
    intent,
    requiresPatchWorkflow,
    workflowKind,
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

function modelIntentBlocked(error?: string): Omit<WorkflowIntentDecision, "provider" | "model" | "fallbackUsed"> {
  return {
    intent: "ask_user",
    requiresPatchWorkflow: false,
    workflowKind: "ask_user",
    confidence: 0,
    reason: `Model intent classification was unavailable or invalid; TomorrowEdge will not use a local semantic fallback.${error ? ` ${error}` : ""}`
  };
}

function parseWorkflowKind(value: unknown, requiresPatchWorkflow: boolean): WorkflowKind {
  if (value === "read_only" || value === "patch" || value === "repair" || value === "vision_patch" || value === "advisory" || value === "ask_user") return value;
  return requiresPatchWorkflow ? "patch" : "read_only";
}
