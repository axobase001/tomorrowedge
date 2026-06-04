import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import { createProviderRegistry } from "../../providers/registry.js";
import type { ProviderRegistry } from "../../providers/registry.js";
import type { ChatRequest, ChatResponse } from "../../providers/types.js";
import type { ModelRouter } from "../routing/router.js";
import type { EventLedger } from "../events/eventLedger.js";
import { makeId } from "../../utils/ids.js";

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
};

const registryCache = new WeakMap<TomorrowEdgeConfig, ProviderRegistry>();

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
  ledger?: EventLedger
): Promise<Pick<ProviderFallbackResult, "response" | "error">> {
  const provider = cachedProviderRegistry(config).get(providerId);
  const requestId = makeId(`request_${role}`);
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
    return { error };
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
    const message = error instanceof Error ? error.message : String(error);
    ledger?.append({
      type: "model_call",
      status: "failure",
      phase: phaseForRole(role),
      role,
      provider: providerId,
      model,
      requestId,
      promptRef,
      error: message
    });
    return { error: message };
  }
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
