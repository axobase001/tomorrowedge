import type { ChatRequest } from "../../providers/types.js";

type JsonSchema = Record<string, unknown>;

const structuredJsonSchemaProviders = /^(openrouter|openai_compatible|deepseek|kimi)$/i;

export function structuredJsonResponseFormat(provider: string, name: string, schema: JsonSchema): ChatRequest["responseFormat"] {
  if (!supportsJsonSchemaResponseFormat(provider)) return { type: "json_object" };
  return {
    type: "json_schema",
    json_schema: {
      name: safeSchemaName(name),
      strict: true,
      schema
    }
  };
}

export function supportsJsonSchemaResponseFormat(provider: string): boolean {
  return structuredJsonSchemaProviders.test(provider) || /openai|deepseek|openrouter|kimi/i.test(provider);
}

export const workflowIntentResponseSchema = objectSchema({
  intent: { type: "string", enum: ["inspect", "patch", "ask_user"] },
  requiresPatchWorkflow: { type: "boolean" },
  workflowKind: { type: "string", enum: ["read_only", "patch", "repair", "vision_patch", "advisory", "ask_user"] },
  confidence: { type: "number" },
  reason: { type: "string" }
});

export const taskGovernanceResponseSchema = objectSchema({
  reasoningSensitivity: { type: "string", enum: ["low", "medium", "high"] },
  requiresReviewer: { type: "boolean" },
  requiresJudge: { type: "boolean" },
  confidence: { type: "number" },
  reason: { type: "string" }
});

export const plannerPlanResponseSchema = objectSchema({
  taskType: { type: "string", enum: ["bugfix", "feature", "refactor", "test", "docs", "analysis", "unknown"] },
  riskLevel: { type: "string", enum: ["low", "medium", "high"] },
  workflowKind: { type: "string", enum: ["read_only", "patch", "repair", "vision_patch", "advisory", "ask_user"] },
  constraints: stringArraySchema(),
  steps: {
    type: "array",
    items: objectSchema({
      id: { type: "string" },
      title: { type: "string" },
      detail: { type: "string" }
    })
  },
  taskGraph: { anyOf: [{ type: "object" }, { type: "null" }] },
  verificationCommands: stringArraySchema(),
  debateRecommended: { type: "boolean" },
  reasonForDebate: { type: "string" }
});

export const scenarioProfileResponseSchema = objectSchema({
  scenarioType: { type: "string", enum: ["coding", "research", "document", "debugging", "refactor", "analysis", "planning", "ops", "unknown"] },
  userIntent: { type: "string" },
  expectedDeliverable: { type: "string" },
  ambiguityLevel: { type: "string", enum: ["low", "medium", "high"] },
  likelyWorkflowKind: { type: "string", enum: ["read_only", "patch", "repair", "vision_patch", "advisory", "ask_user"] },
  riskSignals: stringArraySchema(),
  evidenceNeeds: stringArraySchema(),
  suggestedRoles: stringArraySchema()
});

export const objectiveContractResponseSchema = objectSchema({
  schemaVersion: { type: "string", enum: ["objective-contract/v1"] },
  contractId: { type: "string" },
  createdAt: { type: "string" },
  goal: { type: "string" },
  normalizedGoal: { type: "string" },
  scenarioType: { type: "string" },
  taskType: { type: "string" },
  workflowKind: { type: "string" },
  localObjective: { type: "string" },
  userScenario: { type: "object" },
  successCriteria: stringArraySchema(),
  failureCriteria: stringArraySchema(),
  requiredEvidence: stringArraySchema(),
  allowedPhases: stringArraySchema(),
  allowedRoles: stringArraySchema(),
  allowedTools: stringArraySchema(),
  forbiddenActions: stringArraySchema(),
  riskLevel: { type: "string" },
  reasoningSensitivity: { type: "string" },
  budget: { type: "object" },
  uncertaintyPolicy: { type: "object" },
  stopCondition: { type: "object" },
  fallbackPolicy: { type: "object" },
  verificationRubric: { type: "object" },
  traceHints: { type: "object" },
  source: { type: "string" },
  confidence: { type: "number" }
}, { additionalProperties: true });

export const livePatchResponseJsonSchema = objectSchema({
  summary: { type: "string" },
  unifiedDiff: { type: "string" },
  filesChanged: stringArraySchema(),
  testPlan: stringArraySchema(),
  knownTradeoffs: stringArraySchema(),
  estimatedRisk: { type: "string", enum: ["low", "medium", "high"] },
  files: {
    type: "array",
    items: objectSchema({
      path: { type: "string" },
      content: { type: "string" }
    })
  }
}, { required: ["summary", "filesChanged", "testPlan", "knownTradeoffs", "estimatedRisk"] });

function objectSchema(properties: Record<string, JsonSchema>, options: { required?: string[]; additionalProperties?: boolean } = {}): JsonSchema {
  return {
    type: "object",
    additionalProperties: options.additionalProperties ?? false,
    properties,
    required: options.required ?? Object.keys(properties)
  };
}

function stringArraySchema(): JsonSchema {
  return { type: "array", items: { type: "string" } };
}

function safeSchemaName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "tomorrowedge_schema";
}
