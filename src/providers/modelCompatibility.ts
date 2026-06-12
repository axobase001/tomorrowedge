import type { ProviderConfig } from "../config/schema.js";

export function assertProviderModelCompatible(providerId: string, model: string, provider?: Pick<ProviderConfig, "base_url">): void {
  const reason = providerModelMismatchReason(providerId, model, provider);
  if (reason) throw new Error(reason);
}

export function providerModelMismatchReason(providerId: string, model: string, provider?: Pick<ProviderConfig, "base_url">): string | undefined {
  const normalizedProvider = normalizeProviderKey(providerId);
  const trimmed = model.trim();
  if (!trimmed || trimmed === "auto") return undefined;
  if (normalizedProvider.startsWith("external_")) return undefined;

  if (normalizedProvider === "openrouter") {
    return trimmed.includes("/")
      ? undefined
      : `Model "${trimmed}" does not look like an OpenRouter model id. Use provider/model form such as openai/gpt-5.2, or choose a catalog model.`;
  }
  if (normalizedProvider === "deepseek") {
    return /^deepseek[-_]/i.test(trimmed) && !looksLikeRoutedModelId(trimmed)
      ? undefined
      : `Model "${trimmed}" does not match provider deepseek. Use a DeepSeek model id such as deepseek-chat or deepseek-reasoner.`;
  }
  if (normalizedProvider === "kimi") {
    return /^kimi[-_]/i.test(trimmed) && !looksLikeRoutedModelId(trimmed)
      ? undefined
      : `Model "${trimmed}" does not match provider kimi. Use a Kimi model id such as kimi-k2.6 or kimi-latest.`;
  }
  if (normalizedProvider === "mimo") {
    return /^mimo[-_]/i.test(trimmed) && !looksLikeRoutedModelId(trimmed)
      ? undefined
      : `Model "${trimmed}" does not match provider mimo. Use a MiMo model id such as mimo-v2.5-pro.`;
  }
  if (normalizedProvider === "anthropic") {
    return /^claude[-_]/i.test(trimmed) && !looksLikeRoutedModelId(trimmed)
      ? undefined
      : `Model "${trimmed}" does not match provider anthropic. Use a Claude model id such as claude-sonnet-4.5.`;
  }
  if (normalizedProvider === "gemini") {
    return /^gemini[-_]/i.test(trimmed) && !looksLikeRoutedModelId(trimmed)
      ? undefined
      : `Model "${trimmed}" does not match provider gemini. Use a Gemini model id such as gemini-2.5-pro.`;
  }
  if (normalizedProvider === "openai_compatible" && isDefaultOpenAiEndpoint(provider?.base_url)) {
    return looksLikeRoutedModelId(trimmed)
      ? `Model "${trimmed}" is a routed provider/model id, but openai_compatible is using the default OpenAI endpoint. Choose a plain OpenAI model id or switch provider to OpenRouter.`
      : undefined;
  }
  return undefined;
}

function looksLikeRoutedModelId(model: string): boolean {
  return model.includes("/") || /:free\b/i.test(model) || /:nitro\b/i.test(model);
}

function isDefaultOpenAiEndpoint(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  try {
    const url = new URL(baseUrl);
    return url.hostname === "api.openai.com";
  } catch {
    return false;
  }
}

function normalizeProviderKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_");
}
