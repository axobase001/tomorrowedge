import type { ChatRequest, ChatResponse, ModelInfo, ModelProvider } from "./types.js";

export type OpenAICompatibleOptions = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  defaultModel?: string;
  extraHeaders?: Record<string, string>;
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
    const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options.apiKey}`,
        ...(this.options.extraHeaders ?? {})
      },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        temperature: req.temperature ?? 0.2,
        ...(req.maxCompletionTokens ? { max_completion_tokens: req.maxCompletionTokens } : {})
      })
    });
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
    return Boolean(this.options.baseUrl && this.options.apiKey);
  }
}
