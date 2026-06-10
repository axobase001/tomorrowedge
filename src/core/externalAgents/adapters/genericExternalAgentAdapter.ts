import type { AgentRole } from "../../../schemas/agentTask.js";
import type { ExternalOutputContract } from "../contracts/externalTaskEnvelope.js";
import type { ExternalAgentAdapter, ExternalAgentNormalizationStrictness, ExternalAgentResponseMode } from "../externalAgentTypes.js";
import type { ExternalAgentAdapterRuntime } from "./externalAgentAdapter.js";

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
  const jsonBlockFailed = Boolean(input.responseMode === "json_block" && typeof input.rawPayload === "string" && parsed === input.rawPayload);
  if (jsonBlockFailed) warnings.push("responseMode=json_block requested but no JSON block or object was found");
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
  const status = strict && (strictJsonFailed || jsonBlockFailed || !contractMatched) ? "failed" : warnings.length ? "warning" : "success";
  return { adapter: input.adapter, responseMode: input.responseMode, status, payload, warnings, summary };
}

export const genericExternalAgentAdapter: ExternalAgentAdapterRuntime = {
  id: "generic",
  supports: () => true,
  buildPrompt: (input) => [
    input.prompt,
    "",
    `TomorrowEdge role: ${input.role}`,
    `Output contract: ${input.envelope.outputContract}`,
    "Return a typed role result. Prefer JSON when possible.",
    "Envelope:",
    JSON.stringify(input.envelope, null, 2)
  ].join("\n"),
  normalizeOutput: normalizeGenericExternalAgentResult,
  extractEvidence: (input) => {
    const evidence: string[] = [];
    const payload = asRecord(input.normalized.payload);
    if (payload?.summary) evidence.push(`summary: ${String(payload.summary).slice(0, 240)}`);
    if (input.normalized.status === "warning") evidence.push(`normalization warnings: ${input.normalized.warnings.join("; ")}`);
    if (input.outputContract !== "freeform") evidence.push(`contract=${input.outputContract} status=${input.normalized.status}`);
    return evidence;
  },
  detectFailure: (input) => ({
    failed: input.normalized.status === "failed",
    reason: input.normalized.warnings.join("; ") || undefined,
    retryable: input.normalized.status === "failed",
    category: input.normalized.status === "failed" ? "missing_contract" : undefined
  }),
  retryPolicy: ({ failure, attempt }) => ({
    retry: Boolean(failure.retryable && attempt < 2),
    reason: failure.reason ?? "generic adapter retry policy"
  }),
  estimateCost: estimateExternalCost
};

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

export function estimateExternalCost(rawPayload: unknown): { inputTokens?: number; outputTokens?: number; totalTokens?: number; estimatedCostUsd?: number } {
  const object = asRecord(rawPayload);
  const usage = asRecord(object?.usage) ?? asRecord(object?.costUsage) ?? asRecord(object?.cost);
  const inputTokens = numberOrUndefined(usage?.inputTokens ?? usage?.promptTokens ?? usage?.prompt_tokens);
  const outputTokens = numberOrUndefined(usage?.outputTokens ?? usage?.completionTokens ?? usage?.completion_tokens);
  const totalTokens = numberOrUndefined(usage?.totalTokens ?? usage?.total_tokens) ?? (inputTokens !== undefined || outputTokens !== undefined ? (inputTokens ?? 0) + (outputTokens ?? 0) : undefined);
  const estimatedCostUsd = numberOrUndefined(usage?.estimatedCostUsd ?? usage?.costUsd ?? usage?.usd);
  return { inputTokens, outputTokens, totalTokens, estimatedCostUsd };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
