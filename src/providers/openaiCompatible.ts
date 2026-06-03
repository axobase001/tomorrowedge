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
    const tokenField = this.options.apiFormat === "legacy_chat" ? "max_tokens" : "max_completion_tokens";
    const controller = new AbortController();
    const timeoutMs = this.options.requestTimeoutMs ?? 60_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
          ...(this.options.extraHeaders ?? {})
        },
        body: JSON.stringify({
          model: req.model || this.options.defaultModel,
          messages: req.messages,
          temperature: req.temperature ?? 0.2,
          ...(req.maxCompletionTokens ? { [tokenField]: req.maxCompletionTokens } : {})
        })
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`${this.id} request timed out after ${timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
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

  private authHeaders(): Record<string, string> {
    if (!this.options.apiKey || this.options.authHeader === "none") return {};
    if (this.options.authHeader === "api-key") return { "api-key": this.options.apiKey };
    return { Authorization: `Bearer ${this.options.apiKey}` };
  }
}
