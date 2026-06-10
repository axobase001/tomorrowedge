import type { AgentRole } from "../../../schemas/agentTask.js";
import type { ExternalOutputContract } from "../contracts/externalTaskEnvelope.js";
import type { ExternalAgentAdapter, ExternalAgentNormalizationStrictness, ExternalAgentResponseMode } from "../externalAgentTypes.js";

export type ExternalAgentNormalizationInput = {
  externalAgentId: string;
  adapter: ExternalAgentAdapter;
  responseMode: ExternalAgentResponseMode;
  role: AgentRole;
  outputContract: ExternalOutputContract;
  rawPayload: unknown;
  strictJson?: boolean;
  normalizationStrictness?: ExternalAgentNormalizationStrictness;
};

export type ExternalAgentNormalizationResult = {
  adapter: ExternalAgentAdapter;
  responseMode: ExternalAgentResponseMode;
  status: "success" | "warning" | "failed";
  payload: unknown;
  warnings: string[];
  summary: string;
};

export function normalizeGenericExternalAgentResult(input: ExternalAgentNormalizationInput): ExternalAgentNormalizationResult {
  const parsed = typeof input.rawPayload === "string" ? parseJsonish(input.rawPayload) : input.rawPayload;
  const warnings: string[] = [];
  const strictJsonFailed = Boolean(input.strictJson && typeof input.rawPayload === "string" && parsed === input.rawPayload);
  if (strictJsonFailed) warnings.push("strictJson requested but payload was not valid JSON");
  const payload = parsed ?? input.rawPayload;
  const object = asRecord(payload);
  const contractMatched = outputMatchesContract(payload, input.outputContract);
  if (!contractMatched && input.outputContract !== "freeform") {
    warnings.push(`payload does not satisfy outputContract=${input.outputContract}`);
  }
  const summary = typeof object?.summary === "string" && object.summary.trim()
    ? object.summary.trim()
    : `External ${input.role} returned ${input.outputContract} payload.`;
  const strict = input.normalizationStrictness === "strict";
  const status = strict && (strictJsonFailed || !contractMatched) ? "failed" : warnings.length ? "warning" : "success";
  return { adapter: input.adapter, responseMode: input.responseMode, status, payload, warnings, summary };
}

export function parseJsonish(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]!.trim());
      } catch {
        return value;
      }
    }
    const object = /\{[\s\S]*\}/.exec(trimmed);
    if (object) {
      try {
        return JSON.parse(object[0]);
      } catch {
        return value;
      }
    }
    return value;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function outputMatchesContract(payload: unknown, contract: ExternalOutputContract): boolean {
  if (contract === "freeform") return true;
  const object = asRecord(payload);
  if (!object) return false;
  if (contract === "plan") return Boolean(asRecord(object.plan) || Array.isArray(object.steps));
  if (contract === "patch") return Boolean(asRecord(object.candidate) || typeof object.unifiedDiff === "string" || typeof object.diff === "string");
  if (contract === "review") return Boolean(asRecord(object.review) || Array.isArray(object.reviews));
  if (contract === "judgment") return Boolean(asRecord(object.judgment) || typeof object.decision === "string");
  return false;
}
