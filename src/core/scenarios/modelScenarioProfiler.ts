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

export const SCENARIO_PROFILER_MAX_COMPLETION_TOKENS = 1200;
const SCENARIO_PROFILER_REPAIR_MAX_COMPLETION_TOKENS = 900;

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
      maxCompletionTokens: SCENARIO_PROFILER_MAX_COMPLETION_TOKENS,
      responseFormat: { type: "json_object" },
      metadata: { tomorrowedgeTask: "scenario_profile" },
      messages: [
        {
          role: "system",
          content: [
            "You are TomorrowEdge's semantic scenario profiler.",
            "Classify the user's software-engineering request by meaning, not keywords.",
            "Return strict compact JSON only. No markdown, no prose outside JSON.",
            "Use keys: scenarioType, userIntent, expectedDeliverable, ambiguityLevel, likelyWorkflowKind, riskSignals, evidenceNeeds, suggestedRoles.",
            "scenarioType must be one of: coding, research, document, debugging, refactor, analysis, planning, ops, unknown.",
            "ambiguityLevel must be one of: low, medium, high.",
            "likelyWorkflowKind must be one of: read_only, patch, repair, vision_patch, advisory, ask_user.",
            "suggestedRoles must use TomorrowEdge roles: core, planner, explorer, coder_a, coder_b, reviewer, judge, runner, repairer, summarizer, vision.",
            "Risk signals should describe semantic risk such as security_sensitive, irreversible_or_production, correctness_critical, full_access, ambiguous_scope.",
            "Keep userIntent and expectedDeliverable under 240 characters each."
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
  const parsed = parseScenarioProfileWithDiagnostics(result.response?.content);
  if (parsed.profile) {
    return {
      profile: parsed.profile,
      provider: result.provider,
      model: result.model
    };
  }
  const repaired = result.response?.content && !input.localOnly
    ? await repairScenarioProfile({
        ...input,
        provider: result.provider,
        model: result.model,
        originalContent: result.response.content,
        parseError: parsed.error
      })
    : undefined;
  return {
    profile: repaired?.profile,
    provider: repaired?.provider ?? result.provider,
    model: repaired?.model ?? result.model,
    error: repaired?.profile ? undefined : result.error ?? repaired?.error ?? parsed.error ?? "scenario profiler model returned invalid JSON"
  };
}

export function parseScenarioProfile(content?: string): ScenarioProfile | undefined {
  return parseScenarioProfileWithDiagnostics(content).profile;
}

export function parseScenarioProfileWithDiagnostics(content?: string): { profile?: ScenarioProfile; error?: string } {
  if (!content) return { error: "scenario profiler returned empty content" };
  const objectResult = parseJsonObject(content);
  if (!objectResult.object) return { error: objectResult.error ?? "scenario profiler returned invalid JSON" };
  const object = objectResult.object;
  const scenarioType = parseScenarioType(object.scenarioType);
  const ambiguityLevel = parseAmbiguity(object.ambiguityLevel);
  const likelyWorkflowKind = parseWorkflowKind(object.likelyWorkflowKind);
  if (!scenarioType) return { error: "scenario profiler returned unsupported scenarioType" };
  if (!ambiguityLevel) return { error: "scenario profiler returned unsupported ambiguityLevel" };
  if (!likelyWorkflowKind) return { error: "scenario profiler returned unsupported likelyWorkflowKind" };
  const riskSignals = stringArray(object.riskSignals);
  const evidenceNeeds = stringArray(object.evidenceNeeds);
  const suggestedRoles = roleArray(object.suggestedRoles);
  return { profile: {
    scenarioType,
    userIntent: nonEmptyString(object.userIntent) ?? `${scenarioType} request`,
    expectedDeliverable: nonEmptyString(object.expectedDeliverable) ?? "auditable workflow result",
    ambiguityLevel,
    likelyWorkflowKind,
    riskSignals,
    evidenceNeeds: evidenceNeeds.length ? evidenceNeeds : ["event ledger"],
    suggestedRoles: suggestedRoles.length ? suggestedRoles : ["planner", "explorer", "summarizer"]
  } };
}

async function repairScenarioProfile(input: {
  goal: string;
  workflowIntent: Pick<WorkflowIntentDecision, "intent" | "requiresPatchWorkflow" | "workflowKind">;
  accessMode: AccessMode;
  hasImageInputs?: boolean;
  config: TomorrowEdgeConfig;
  router: ModelRouter;
  ledger: EventLedger;
  localOnly?: boolean;
  provider: string;
  model: string;
  originalContent: string;
  parseError?: string;
}): Promise<ModelScenarioProfileResult> {
  input.ledger.append({
    type: "evidence_update",
    phase: "planning",
    role: "planner",
    provider: input.provider,
    model: input.model,
    evidence: [`scenario profile invalid: ${input.parseError ?? "unknown parse error"}`, "requesting same-model scenario profile repair"]
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
      maxCompletionTokens: SCENARIO_PROFILER_REPAIR_MAX_COMPLETION_TOKENS,
      responseFormat: { type: "json_object" },
      metadata: { tomorrowedgeTask: "scenario_profile_repair" },
      messages: [
        {
          role: "system",
          content: [
            "Repair TomorrowEdge scenario profiler output into valid strict JSON.",
            "Return JSON only. No markdown.",
            "Required keys: scenarioType, userIntent, expectedDeliverable, ambiguityLevel, likelyWorkflowKind, riskSignals, evidenceNeeds, suggestedRoles.",
            "Keep userIntent and expectedDeliverable under 200 characters each."
          ].join("\n")
        },
        {
          role: "user",
          content: JSON.stringify({
            goal: input.goal,
            workflowIntent: input.workflowIntent,
            accessMode: input.accessMode,
            hasImageInputs: Boolean(input.hasImageInputs),
            parseError: input.parseError,
            invalidOutput: input.originalContent.slice(0, 5000)
          }, null, 2)
        }
      ]
    })
  });
  const parsed = parseScenarioProfileWithDiagnostics(result.response?.content);
  return {
    profile: parsed.profile,
    provider: result.response ? result.provider : input.provider,
    model: result.response ? result.model : input.model,
    error: parsed.profile ? undefined : result.error ?? parsed.error ?? "scenario profile repair returned invalid JSON"
  };
}

function parseJsonObject(content: string): { object?: Record<string, unknown>; error?: string } {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { object: parsed as Record<string, unknown> }
      : { error: "scenario profile JSON root is not an object" };
  } catch (error) {
    const match = /\{[\s\S]*\}/.exec(content);
    if (!match) return { error: error instanceof Error ? error.message : "scenario profiler content is not JSON" };
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? { object: parsed as Record<string, unknown> }
        : { error: "scenario profile JSON root is not an object" };
    } catch (innerError) {
      return { error: innerError instanceof Error ? innerError.message : "scenario profiler content is not valid JSON" };
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
  if (typeof value === "string" && value.trim()) {
    return value.split(/[,;；，、]|\band\b/i).map((item) => item.trim()).filter(Boolean);
  }
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
