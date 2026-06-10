import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import { createProviderRegistry } from "../../providers/registry.js";
import type { ProviderRegistry } from "../../providers/registry.js";
import type { ChatRequest, ChatResponse } from "../../providers/types.js";
import type { ModelRouter } from "../routing/router.js";
import type { EventLedger } from "../events/eventLedger.js";
import { makeId } from "../../utils/ids.js";
import { formatProviderError, redactProviderError, shouldSkipAfterProviderError, type ProviderErrorCategory } from "../../safety/providerRedaction.js";

export type ProviderFallbackResult = {
  provider: string;
  model: string;
  response?: ChatResponse;
  error?: string;
  errorCategory?: ProviderErrorCategory;
  fallbackUsed?: boolean;
  fallbackFrom?: {
    provider: string;
    model: string;
  };
  fallbackReason?: string;
};

const registryCache = new WeakMap<TomorrowEdgeConfig, ProviderRegistry>();
const blockedProviderCache = new WeakMap<EventLedger, Map<string, ProviderErrorCategory>>();

export async function chatWithProviderFallback(input: {
  config: TomorrowEdgeConfig;
  router: ModelRouter;
  role: AgentRole;
  provider: string;
  model: string;
  buildRequest: (model: string, provider: string) => ChatRequest;
  ledger?: EventLedger;
  allowFallback?: boolean;
  markProviderUnavailable?: boolean;
}): Promise<ProviderFallbackResult> {
  const primary = { provider: input.provider, model: input.model };
  const primaryResult = await tryChat(input.config, input.role, primary.provider, primary.model, input.buildRequest, input.ledger, input.markProviderUnavailable ?? true);
  const fallbackAllowed = input.allowFallback !== false;
  if (primaryResult.response || !fallbackAllowed || !input.config.routing.fallback || primary.provider === "local_tool") {
    return { ...primary, ...primaryResult };
  }

  const fallback = input.router.fallbackFor(input.role);
  if (!fallback || fallback.provider === primary.provider) {
    return { ...primary, ...primaryResult };
  }

  const fallbackResult = await tryChat(input.config, input.role, fallback.provider, fallback.model, input.buildRequest, input.ledger, input.markProviderUnavailable ?? true);
  if (!fallbackResult.response) {
    return {
      ...primary,
      error: `${primaryResult.error} Fallback ${fallback.provider}/${fallback.model} also failed: ${fallbackResult.error}`,
      errorCategory: primaryResult.errorCategory ?? fallbackResult.errorCategory,
      fallbackReason: primaryResult.error
    };
  }

  input.ledger?.append({
    type: "provider_fallback",
    phase: "routing",
    role: input.role,
    fromProvider: primary.provider,
    fromModel: primary.model,
    toProvider: fallback.provider,
    toModel: fallback.model,
    reason: primaryResult.error ?? "provider fallback used"
  });

  return {
    provider: fallback.provider,
    model: fallback.model,
    response: fallbackResult.response,
    fallbackUsed: true,
    fallbackFrom: primary,
    fallbackReason: primaryResult.error
  };
}

async function tryChat(
  config: TomorrowEdgeConfig,
  role: AgentRole,
  providerId: string,
  model: string,
  buildRequest: (model: string, provider: string) => ChatRequest,
  ledger?: EventLedger,
  markUnavailable = true
): Promise<Pick<ProviderFallbackResult, "response" | "error" | "errorCategory">> {
  const provider = cachedProviderRegistry(config).get(providerId);
  const requestId = makeId(`request_${role}`);
  const request = buildRequest(model, providerId);
  const promptRef = ledger?.writeArtifact("prompts", JSON.stringify(request.messages, null, 2), "json");
  const blockedCategory = ledger ? blockedProviderCache.get(ledger)?.get(providerId) : undefined;
  if (blockedCategory) {
    const error = `${blockedCategory}: skipped ${providerId}/${model} because a prior live call in this run hit ${blockedCategory}.`;
    ledger?.append({
      type: "model_call",
      status: "failure",
      phase: phaseForRole(role),
      role,
      provider: providerId,
      model,
      requestId,
      promptRef,
      error,
      errorCategory: blockedCategory,
      skipped: true
    });
    return { error, errorCategory: blockedCategory };
  }
  ledger?.append({
    type: "model_call",
    status: "start",
    phase: phaseForRole(role),
    role,
    provider: providerId,
    model,
    requestId,
    promptRef
  });
  if (!provider) {
    const error = `Provider ${providerId} is not configured or unavailable.`;
    ledger?.append({
      type: "model_call",
      status: "failure",
      phase: phaseForRole(role),
      role,
      provider: providerId,
      model,
      requestId,
      promptRef,
      error
    });
    return { error, errorCategory: "unknown" };
  }
  try {
    const response = await provider.chat(request);
    ledger?.append({
      type: "model_call",
      status: "success",
      phase: phaseForRole(role),
      role,
      provider: providerId,
      model,
      requestId,
      promptRef,
      responseRef: ledger.writeArtifact("responses", response.content),
      inputTokens: response.usage?.inputTokens,
      outputTokens: response.usage?.outputTokens
    });
    return { response };
  } catch (error) {
    const report = redactProviderError(error);
    const message = formatProviderError(report);
    if (markUnavailable && ledger && shouldSkipAfterProviderError(report.category)) {
      markProviderBlocked(ledger, providerId, report.category);
    }
    ledger?.append({
      type: "model_call",
      status: "failure",
      phase: phaseForRole(role),
      role,
      provider: providerId,
      model,
      requestId,
      promptRef,
      error: message,
      errorCategory: report.category,
      statusCode: report.statusCode,
      retryable: report.retryable
    });
    return { error: message, errorCategory: report.category };
  }
}

function markProviderBlocked(ledger: EventLedger, providerId: string, category: ProviderErrorCategory): void {
  const existing = blockedProviderCache.get(ledger) ?? new Map<string, ProviderErrorCategory>();
  existing.set(providerId, category);
  blockedProviderCache.set(ledger, existing);
  ledger.append({
    type: "provider_fallback",
    phase: "routing",
    fromProvider: providerId,
    fromModel: "*",
    toProvider: "fallback",
    toModel: "*",
    reason: `${category}: provider marked unavailable for this run after live call failure.`,
    errorCategory: category
  });
}

function cachedProviderRegistry(config: TomorrowEdgeConfig): ProviderRegistry {
  const cached = registryCache.get(config);
  if (cached) return cached;
  const registry = createProviderRegistry(config);
  registryCache.set(config, registry);
  return registry;
}

function phaseForRole(role: AgentRole) {
  if (role === "vision") return "vision";
  if (role === "planner") return "planning";
  if (role === "explorer") return "exploration";
  if (role === "reviewer") return "review";
  if (role === "judge") return "judge";
  if (role === "repairer") return "repair";
  if (role === "summarizer") return "summary";
  if (role === "runner") return "shell";
  return "coding";
}
