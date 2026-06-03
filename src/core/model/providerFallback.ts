import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import { createProviderRegistry } from "../../providers/registry.js";
import type { ChatRequest, ChatResponse } from "../../providers/types.js";
import type { ModelRouter } from "../routing/router.js";

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

export async function chatWithProviderFallback(input: {
  config: TomorrowEdgeConfig;
  router: ModelRouter;
  role: AgentRole;
  provider: string;
  model: string;
  buildRequest: (model: string, provider: string) => ChatRequest;
}): Promise<ProviderFallbackResult> {
  const primary = { provider: input.provider, model: input.model };
  const primaryResult = await tryChat(input.config, primary.provider, primary.model, input.buildRequest);
  if (primaryResult.response || !input.config.routing.fallback || primary.provider === "local_tool") {
    return { ...primary, ...primaryResult };
  }

  const fallback = input.router.fallbackFor(input.role);
  if (!fallback || fallback.provider === primary.provider) {
    return { ...primary, ...primaryResult };
  }

  const fallbackResult = await tryChat(input.config, fallback.provider, fallback.model, input.buildRequest);
  if (!fallbackResult.response) {
    return {
      ...primary,
      error: `${primaryResult.error} Fallback ${fallback.provider}/${fallback.model} also failed: ${fallbackResult.error}`,
      fallbackReason: primaryResult.error
    };
  }

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
  providerId: string,
  model: string,
  buildRequest: (model: string, provider: string) => ChatRequest
): Promise<Pick<ProviderFallbackResult, "response" | "error">> {
  const provider = createProviderRegistry(config).get(providerId);
  if (!provider) {
    return { error: `Provider ${providerId} is not configured or unavailable.` };
  }
  try {
    return { response: await provider.chat(buildRequest(model, providerId)) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
