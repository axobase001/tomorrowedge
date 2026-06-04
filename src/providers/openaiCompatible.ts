import type { ChatRequest, ChatResponse, ModelInfo, ModelProvider } from "./types.js";
import type { ProviderApiFormat, ProviderAuthHeader } from "../config/schema.js";

export type OpenAICompatibleOptions = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  defaultModel?: string;
  apiFormat?: ProviderApiFormat;
  authHeader?: ProviderAuthHeader;
  extraHeaders?: Record<string, string>;
  requestTimeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
};

export class OpenAICompatibleProvider implements ModelProvider {
  kind = "cloud" as const;

  constructor(private readonly options: OpenAICompatibleOptions) {}

  get id(): string {
    return this.options.id;
  }

  get name(): string {
    return this.options.name;
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.isConfigured()) return [];
    return [{ id: this.options.defaultModel ?? "configured-model", label: "Configured OpenAI-compatible model" }];
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (!this.isConfigured()) {
      throw new Error(`${this.id} is disabled because API key or base URL is missing.`);
    }
    const body: Record<string, unknown> = {
      model: req.model || this.options.defaultModel,
      messages: req.messages,
      temperature: req.temperature ?? 0.2
    };
    const tokenField = this.options.apiFormat === "legacy_chat" ? "max_tokens" : "max_completion_tokens";
    if (req.maxCompletionTokens) body[tokenField] = req.maxCompletionTokens;
    if (req.responseFormat) body.response_format = req.responseFormat;
    const response = await this.fetchWithRetry(body);
    if (!response.ok) {
      throw new Error(`${this.id} request failed: ${response.status} ${await response.text()}`);
    }
    const json = (await response.json()) as {
      id?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      id: json.id ?? `${this.id}-response`,
      model: req.model,
      content: json.choices?.[0]?.message?.content ?? "",
      usage: json.usage
        ? {
            inputTokens: json.usage.prompt_tokens ?? 0,
            outputTokens: json.usage.completion_tokens ?? 0
          }
        : undefined
    };
  }

  private isConfigured(): boolean {
    return Boolean(this.options.baseUrl && (this.options.authHeader === "none" || this.options.apiKey));
  }

  private async fetchWithRetry(body: Record<string, unknown>): Promise<Response> {
    const maxRetries = this.options.maxRetries ?? 2;
    const retryBaseDelayMs = this.options.retryBaseDelayMs ?? 1000;
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await this.fetchOnce(body);
        if (!isRetryableStatus(response.status) || attempt === maxRetries) return response;
        lastError = new Error(`${this.id} retryable response: ${response.status}`);
      } catch (error) {
        lastError = error;
        if (attempt === maxRetries || !isRetryableError(error)) throw error;
      }
      await delay(retryDelayMs(attempt, retryBaseDelayMs));
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async fetchOnce(body: Record<string, unknown>): Promise<Response> {
    const controller = new AbortController();
    const timeoutMs = this.options.requestTimeoutMs ?? 120_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
          ...(this.options.extraHeaders ?? {})
        },
        body: JSON.stringify(body)
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`${this.id} request timed out after ${timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private authHeaders(): Record<string, string> {
    if (!this.options.apiKey || this.options.authHeader === "none") return {};
    if (this.options.authHeader === "api-key") return { "api-key": this.options.apiKey };
    return { Authorization: `Bearer ${this.options.apiKey}` };
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isRetryableError(error: unknown): boolean {
  return error instanceof Error && /timed out|network|fetch failed|ECONNRESET|ETIMEDOUT/i.test(error.message);
}

function retryDelayMs(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * 2 ** attempt;
}

function delay(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}
