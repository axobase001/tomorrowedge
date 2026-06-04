import type { ChatMessage, ChatMessageContent, ChatRequest, ChatResponse, ModelInfo, ModelProvider } from "./types.js";

export type AnthropicProviderOptions = {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  extraHeaders?: Record<string, string>;
  requestTimeoutMs?: number;
  anthropicVersion?: string;
};

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "url"; url: string } | { type: "base64"; media_type: string; data: string } };

export class AnthropicProvider implements ModelProvider {
  readonly id = "anthropic";
  readonly name = "Anthropic";
  readonly kind = "cloud" as const;

  constructor(private readonly options: AnthropicProviderOptions) {}

  async listModels(): Promise<ModelInfo[]> {
    if (!this.isConfigured()) return [];
    return [{ id: this.options.defaultModel ?? "claude-sonnet-4-5", label: "Configured Anthropic Messages model" }];
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (!this.isConfigured()) {
      throw new Error("anthropic is disabled because API key or base URL is missing.");
    }
    const body = {
      model: req.model || this.options.defaultModel,
      max_tokens: req.maxCompletionTokens ?? 1024,
      temperature: req.temperature ?? 0.2,
      system: systemPrompt(req.messages),
      messages: req.messages.filter((message) => message.role !== "system").map(toAnthropicMessage)
    };
    const response = await this.fetchMessages(body);
    if (!response.ok) {
      throw new Error(`anthropic request failed: ${response.status} ${await response.text()}`);
    }
    const json = (await response.json()) as {
      id?: string;
      model?: string;
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    return {
      id: json.id ?? "anthropic-response",
      model: json.model ?? req.model,
      content: json.content?.filter((part) => part.type === "text").map((part) => part.text ?? "").join("") ?? "",
      usage: json.usage
        ? {
            inputTokens: json.usage.input_tokens ?? 0,
            outputTokens: json.usage.output_tokens ?? 0
          }
        : undefined
    };
  }

  private isConfigured(): boolean {
    return Boolean(this.options.apiKey && this.baseUrl());
  }

  private async fetchMessages(body: Record<string, unknown>): Promise<Response> {
    const controller = new AbortController();
    const timeoutMs = this.options.requestTimeoutMs ?? 120_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${this.baseUrl()}/messages`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.options.apiKey ?? "",
          "anthropic-version": this.options.anthropicVersion ?? "2023-06-01",
          ...(this.options.extraHeaders ?? {})
        },
        body: JSON.stringify(body)
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`anthropic request timed out after ${timeoutMs}ms.`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private baseUrl(): string {
    return (this.options.baseUrl || "https://api.anthropic.com/v1").replace(/\/$/, "");
  }
}

export function createAnthropicProvider(apiKey?: string, defaultModel?: string, baseUrl?: string, extraHeaders?: Record<string, string>): AnthropicProvider {
  return new AnthropicProvider({ apiKey, defaultModel, baseUrl, extraHeaders });
}

function systemPrompt(messages: ChatMessage[]): string | undefined {
  const text = messages.filter((message) => message.role === "system").map((message) => contentToText(message.content)).filter(Boolean).join("\n\n");
  return text || undefined;
}

function toAnthropicMessage(message: ChatMessage): { role: "user" | "assistant"; content: string | AnthropicContentBlock[] } {
  return {
    role: message.role === "assistant" ? "assistant" : "user",
    content: toAnthropicContent(message.content)
  };
}

function toAnthropicContent(content: ChatMessageContent): string | AnthropicContentBlock[] {
  if (typeof content === "string") return content;
  return content.map((part): AnthropicContentBlock => {
    if (part.type === "text") return { type: "text", text: part.text };
    const parsed = parseDataUrl(part.image_url.url);
    if (parsed) return { type: "image", source: { type: "base64", media_type: parsed.mediaType, data: parsed.data } };
    return { type: "image", source: { type: "url", url: part.image_url.url } };
  });
}

function contentToText(content: ChatMessageContent): string {
  if (typeof content === "string") return content;
  return content.map((part) => (part.type === "text" ? part.text : `[image:${part.image_url.url}]`)).join("\n");
}

function parseDataUrl(value: string): { mediaType: string; data: string } | undefined {
  const match = value.match(/^data:([^;,]+);base64,(.+)$/);
  return match ? { mediaType: match[1] ?? "image/png", data: match[2] ?? "" } : undefined;
}
