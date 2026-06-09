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
  const heuristic = classifyWorkflowIntentLocally(input.goal);
  if (input.fixtureMode || input.localOnly || heuristic.confidence >= 0.9) {
    return {
      ...heuristic,
      provider: "local_intent_classifier",
      model: "heuristic",
      fallbackUsed: input.fixtureMode || input.localOnly
    };
  }
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
  if (decision.requiresPatchWorkflow) {
    if (plan.taskType !== "analysis") return { ...plan, workflowKind: decision.workflowKind, requiresPatchWorkflow: true };
    return {
      ...plan,
      taskType: "unknown",
      workflowKind: decision.workflowKind,
      requiresPatchWorkflow: true,
      verificationCommands: plan.verificationCommands?.length ? plan.verificationCommands : ["npm test"],
      steps: [
        { id: "understand", title: "Understand task", detail: "Use intent routing to preserve the requested patch workflow.", status: "done" },
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

export function classifyWorkflowIntentLocally(goal: string): Omit<WorkflowIntentDecision, "provider" | "model" | "fallbackUsed"> {
  const text = goal.toLowerCase();
  const explicitPatch = classifyExplicitPatchIntent(goal, text);
  if (explicitPatch) return explicitPatch;
  const hasImage = /\b(image|screenshot|ui screenshot|design|layout)\b|截图|图片|界面图|设计稿/.test(text);
  const asksGenerateUi = /\b(generate|create|build|implement|restore)\b.*\b(ui|page|layout|component)\b|生成.*(界面|页面|布局|组件)|还原.*(界面|页面|布局|组件)/.test(text);
  if (hasImage && asksGenerateUi) {
    return {
      intent: "patch",
      requiresPatchWorkflow: true,
      workflowKind: "vision_patch",
      confidence: 0.92,
      reason: "Local classifier detected image-to-implementation workflow."
    };
  }
  if (/\b(do not edit|don't edit|no changes|read-only|readonly|inspect|list|read|summarize|describe|show|analyze|review architecture|suggest improvements)\b|不要修改|不修改|只读|查看|读取|列出|总结|梳理|分析|建议/.test(text)) {
    return {
      intent: "inspect",
      requiresPatchWorkflow: false,
      workflowKind: "read_only",
      confidence: 0.95,
      reason: "Local classifier detected a read-only inspection request."
    };
  }
  if (/\b(fix|implement|modify|add|repair|refactor|delete|update|write|create)\b|修改|实现|修复|新增|添加|重构|删除|写/.test(text)) {
    return {
      intent: "patch",
      requiresPatchWorkflow: true,
      workflowKind: "patch",
      confidence: 0.88,
      reason: "Local classifier detected a patch-producing request."
    };
  }
  return {
    intent: "ask_user",
    requiresPatchWorkflow: false,
    workflowKind: "ask_user",
    confidence: 0.55,
    reason: "Local classifier could not determine whether file changes are required."
  };
}

function classifyExplicitPatchIntent(goal: string, text: string): Omit<WorkflowIntentDecision, "provider" | "model" | "fallbackUsed"> | undefined {
  const isImageUiTask = /\b(image|screenshot|ui screenshot|design|layout)\b|\u622a\u56fe|\u56fe\u7247|\u754c\u9762\u56fe|\u8bbe\u8ba1\u7a3f/.test(text)
    && /\b(generate|create|build|implement|restore)\b.*\b(ui|page|layout|component)\b|\u751f\u6210.*(\u754c\u9762|\u9875\u9762|\u5e03\u5c40|\u7ec4\u4ef6)|\u8fd8\u539f.*(\u754c\u9762|\u9875\u9762|\u5e03\u5c40|\u7ec4\u4ef6)/.test(text);
  if (isImageUiTask) return undefined;
  const explicitFilePath = /(?:^|[\s`"'(:])((?:(?:[A-Za-z0-9_.@()[\]-]+[\\/])+)?[A-Za-z0-9_.@()[\]-]+\.(?:md|html|tsx?|jsx?|py|rs|go|json|ya?ml|css|txt|toml|lock|java|cpp|c|h|hpp))(?:$|[\s`"',.;:)])/i.test(goal);
  const negatesReadOnly = /\b(not|no)\s+(?:read-only|readonly|inspect-only)\b|\u4e0d\u662f\s*\u53ea\u8bfb|\u4e0d\u8981\s*\u53ea\u8bfb|\u4e0d\u53ea\u662f\s*\u5206\u6790/.test(text);
  const explicitPatch = /\b(fix|implement|modify|add|repair|refactor|delete|update|write|create|generate|build|save|produce|patch)\b|\u4fee\u6539|\u5b9e\u73b0|\u4fee\u590d|\u65b0\u589e|\u6dfb\u52a0|\u91cd\u6784|\u5220\u9664|\u5199\u5165|\u7f16\u5199|\u521b\u5efa|\u65b0\u5efa|\u751f\u6210|\u4fdd\u5b58|\u843d\u5730|\u5fc5\u987b\s*\u751f\u6210\s*patch/.test(text);
  const writesNamedFiles = explicitFilePath && (explicitPatch || /\b(to|as)\s+[^.\n]+\.(?:md|html|tsx?|jsx?|py|rs|go|json|ya?ml|css|txt)\b/i.test(goal));
  if (!negatesReadOnly && !explicitPatch && !writesNamedFiles) return undefined;
  return {
    intent: "patch",
    requiresPatchWorkflow: true,
    workflowKind: "patch",
    confidence: 0.94,
    reason: "Local classifier detected an explicit create/write/patch request before read-only hints."
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

function conservativeFallback(goal: string, error?: string): Omit<WorkflowIntentDecision, "provider" | "model" | "fallbackUsed"> {
  const local = classifyWorkflowIntentLocally(goal);
  if (local.intent !== "ask_user") return { ...local, reason: `${local.reason} Intent model result was unavailable or invalid.${error ? ` ${error}` : ""}` };
  return {
    intent: "ask_user",
    requiresPatchWorkflow: false,
    workflowKind: "ask_user",
    confidence: 0.25,
    reason: `Intent model result was unavailable or invalid; asking user instead of defaulting to patch workflow.${error ? ` ${error}` : ""}`
  };
}

function parseWorkflowKind(value: unknown, requiresPatchWorkflow: boolean): WorkflowKind {
  if (value === "read_only" || value === "patch" || value === "repair" || value === "vision_patch" || value === "advisory" || value === "ask_user") return value;
  return requiresPatchWorkflow ? "patch" : "read_only";
}
