import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import { createProviderRegistry } from "../../providers/registry.js";
import type { ProviderRegistry } from "../../providers/registry.js";
import type { ChatRequest, ChatResponse } from "../../providers/types.js";
import type { ModelRouter } from "../routing/router.js";
import type { EventLedger } from "../events/eventLedger.js";
import { makeId } from "../../utils/ids.js";
import { classifyProviderError, type ProviderErrorCategory, type ProviderErrorDiagnostic } from "../../providers/providerErrors.js";

export type ProviderFallbackResult = {
  provider: string;
  model: string;
  response?: ChatResponse;
  error?: string;
  fallbackUsed?: boolean;
  fallbackFrom?: {
    provider: string;
    model: string;
  };
  fallbackReason?: string;
  errorCategory?: ProviderErrorCategory;
  retryable?: boolean;
  skippedLiveCall?: boolean;
};

const registryCache = new WeakMap<TomorrowEdgeConfig, ProviderRegistry>();
const skippedLiveCallProviders = new WeakMap<EventLedger, Map<string, ProviderErrorDiagnostic>>();

export async function chatWithProviderFallback(input: {
  config: TomorrowEdgeConfig;
  router: ModelRouter;
  role: AgentRole;
  provider: string;
  model: string;
  buildRequest: (model: string, provider: string) => ChatRequest;
  ledger?: EventLedger;
}): Promise<ProviderFallbackResult> {
  const primary = { provider: input.provider, model: input.model };
  const primaryResult = await tryChat(input.config, input.role, primary.provider, primary.model, input.buildRequest, input.ledger);
  if (primaryResult.response || !input.config.routing.fallback || primary.provider === "local_tool") {
    return { ...primary, ...primaryResult };
  }

  const fallback = input.router.fallbackFor(input.role);
  if (!fallback || fallback.provider === primary.provider) {
    return { ...primary, ...primaryResult };
  }

  const fallbackResult = await tryChat(input.config, input.role, fallback.provider, fallback.model, input.buildRequest, input.ledger);
  if (!fallbackResult.response) {
    return {
      ...primary,
      error: `${primaryResult.error} Fallback ${fallback.provider}/${fallback.model} also failed: ${fallbackResult.error}`,
      fallbackReason: primaryResult.error,
      errorCategory: primaryResult.errorCategory,
      retryable: primaryResult.retryable,
      skippedLiveCall: primaryResult.skippedLiveCall
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
    reason: primaryResult.error ?? "provider fallback used",
    errorCategory: primaryResult.errorCategory,
    retryable: primaryResult.retryable
  });

  return {
    provider: fallback.provider,
    model: fallback.model,
    response: fallbackResult.response,
    fallbackUsed: true,
    fallbackFrom: primary,
    fallbackReason: primaryResult.error,
    errorCategory: primaryResult.errorCategory,
    retryable: primaryResult.retryable,
    skippedLiveCall: primaryResult.skippedLiveCall
  };
}

async function tryChat(
  config: TomorrowEdgeConfig,
  role: AgentRole,
  providerId: string,
  model: string,
  buildRequest: (model: string, provider: string) => ChatRequest,
  ledger?: EventLedger
): Promise<Pick<ProviderFallbackResult, "response" | "error" | "errorCategory" | "retryable" | "skippedLiveCall">> {
  const requestId = makeId(`request_${role}`);
  const skipped = ledger ? skippedDiagnosticFor(ledger, providerId) : undefined;
  if (skipped) {
    ledger?.append({
      type: "model_call",
      status: "skipped",
      phase: phaseForRole(role),
      role,
      provider: providerId,
      model,
      requestId,
      error: skipped.message,
      errorCategory: skipped.category,
      retryable: false,
      skippedLiveCall: true
    });
    return {
      error: `Skipped live call for ${providerId}/${model}: ${skipped.category}. ${skipped.message}`,
      errorCategory: skipped.category,
      retryable: false,
      skippedLiveCall: true
    };
  }
  const provider = cachedProviderRegistry(config).get(providerId);
  if (!provider) {
    const missingProvider = classifyProviderError(new Error(`Provider ${providerId} is not configured or unavailable.`));
    ledger?.append({
      type: "model_call",
      status: "start",
      phase: phaseForRole(role),
      role,
      provider: providerId,
      model,
      requestId
    });
    rememberSkippedProvider(ledger, providerId, missingProvider);
    ledger?.append({
      type: "model_call",
      status: "failure",
      phase: phaseForRole(role),
      role,
      provider: providerId,
      model,
      requestId,
      error: missingProvider.message,
      errorCategory: missingProvider.category,
      retryable: missingProvider.retryable
    });
    return {
      error: missingProvider.message,
      errorCategory: missingProvider.category,
      retryable: missingProvider.retryable
    };
  }
  const request = buildRequest(model, providerId);
  const promptRef = ledger?.writeArtifact("prompts", JSON.stringify(request.messages, null, 2), "json");
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
    const diagnostic = classifyProviderError(error);
    rememberSkippedProvider(ledger, providerId, diagnostic);
    ledger?.append({
      type: "model_call",
      status: "failure",
      phase: phaseForRole(role),
      role,
      provider: providerId,
      model,
      requestId,
      promptRef,
      error: diagnostic.message,
      errorCategory: diagnostic.category,
      retryable: diagnostic.retryable
    });
    return { error: diagnostic.message, errorCategory: diagnostic.category, retryable: diagnostic.retryable };
  }
}

function skippedDiagnosticFor(ledger: EventLedger, providerId: string): ProviderErrorDiagnostic | undefined {
  return skippedLiveCallProviders.get(ledger)?.get(providerId);
}

function rememberSkippedProvider(ledger: EventLedger | undefined, providerId: string, diagnostic: ProviderErrorDiagnostic): void {
  if (!ledger || !diagnostic.skipLiveCalls) return;
  const existing = skippedLiveCallProviders.get(ledger) ?? new Map<string, ProviderErrorDiagnostic>();
  existing.set(providerId, diagnostic);
  skippedLiveCallProviders.set(ledger, existing);
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
