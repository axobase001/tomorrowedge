import type { AccessMode, TomorrowEdgeConfig } from "../../config/schema.js";
import { agentRoles, type AgentRole } from "../../schemas/agentTask.js";
import type { EventLedger } from "../events/eventLedger.js";
import type { WorkflowIntentDecision } from "../goal/workflowIntent.js";
import { chatWithProviderFallback } from "../model/providerFallback.js";
import type { WorkflowKind } from "../orchestration/workflowKind.js";
import type { ModelRouter } from "../routing/router.js";
import type { ScenarioProfile, ScenarioType } from "./scenarioTypes.js";

export type ModelScenarioProfileResult = {
  profile?: ScenarioProfile;
  provider: string;
  model: string;
  error?: string;
};

export async function profileScenarioWithModel(input: {
  goal: string;
  workflowIntent: Pick<WorkflowIntentDecision, "intent" | "requiresPatchWorkflow" | "workflowKind">;
  accessMode: AccessMode;
  hasImageInputs?: boolean;
  config: TomorrowEdgeConfig;
  router: ModelRouter;
  ledger: EventLedger;
  localOnly?: boolean;
}): Promise<ModelScenarioProfileResult> {
  const assignment = input.localOnly
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
      maxCompletionTokens: 520,
      responseFormat: { type: "json_object" },
      metadata: { tomorrowedgeTask: "scenario_profile" },
      messages: [
        {
          role: "system",
          content: [
            "You are TomorrowEdge's semantic scenario profiler.",
            "Classify the user's software-engineering request by meaning, not keywords.",
            "Return strict JSON only with keys: scenarioType, userIntent, expectedDeliverable, ambiguityLevel, likelyWorkflowKind, riskSignals, evidenceNeeds, suggestedRoles.",
            "scenarioType must be one of: coding, research, document, debugging, refactor, analysis, planning, ops, unknown.",
            "ambiguityLevel must be one of: low, medium, high.",
            "likelyWorkflowKind must be one of: read_only, patch, repair, vision_patch, advisory, ask_user.",
            "suggestedRoles must use TomorrowEdge roles: core, planner, explorer, coder_a, coder_b, reviewer, judge, runner, repairer, summarizer, vision.",
            "Risk signals should describe semantic risk such as security_sensitive, irreversible_or_production, correctness_critical, full_access, ambiguous_scope."
          ].join("\n")
        },
        {
          role: "user",
          content: JSON.stringify({
            goal: input.goal,
            workflowIntent: input.workflowIntent,
            accessMode: input.accessMode,
            hasImageInputs: Boolean(input.hasImageInputs)
          }, null, 2)
        }
      ]
    })
  });
  const profile = parseScenarioProfile(result.response?.content);
  return {
    profile,
    provider: result.provider,
    model: result.model,
    error: profile ? undefined : result.error ?? "scenario profiler model returned invalid JSON"
  };
}

export function parseScenarioProfile(content?: string): ScenarioProfile | undefined {
  if (!content) return undefined;
  const object = parseJsonObject(content);
  if (!object) return undefined;
  const scenarioType = parseScenarioType(object.scenarioType);
  const ambiguityLevel = parseAmbiguity(object.ambiguityLevel);
  const likelyWorkflowKind = parseWorkflowKind(object.likelyWorkflowKind);
  if (!scenarioType || !ambiguityLevel || !likelyWorkflowKind) return undefined;
  const riskSignals = stringArray(object.riskSignals);
  const evidenceNeeds = stringArray(object.evidenceNeeds);
  const suggestedRoles = roleArray(object.suggestedRoles);
  return {
    scenarioType,
    userIntent: nonEmptyString(object.userIntent) ?? `${scenarioType} request`,
    expectedDeliverable: nonEmptyString(object.expectedDeliverable) ?? "auditable workflow result",
    ambiguityLevel,
    likelyWorkflowKind,
    riskSignals,
    evidenceNeeds: evidenceNeeds.length ? evidenceNeeds : ["event ledger"],
    suggestedRoles: suggestedRoles.length ? suggestedRoles : ["planner", "explorer", "summarizer"]
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

function parseScenarioType(value: unknown): ScenarioType | undefined {
  return value === "coding" || value === "research" || value === "document" || value === "debugging" || value === "refactor" || value === "analysis" || value === "planning" || value === "ops" || value === "unknown"
    ? value
    : undefined;
}

function parseAmbiguity(value: unknown): ScenarioProfile["ambiguityLevel"] | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

function parseWorkflowKind(value: unknown): WorkflowKind | undefined {
  return value === "read_only" || value === "patch" || value === "repair" || value === "vision_patch" || value === "advisory" || value === "ask_user" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
    : [];
}

function roleArray(value: unknown): AgentRole[] {
  const allowed = new Set<string>(agentRoles);
  return stringArray(value).filter((item): item is AgentRole => allowed.has(item));
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
