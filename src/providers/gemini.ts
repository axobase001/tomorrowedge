import type { ChatMessage, ChatMessageContent, ChatRequest, ChatResponse, ModelInfo, ModelProvider } from "./types.js";

export type GeminiProviderOptions = {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  extraHeaders?: Record<string, string>;
  requestTimeoutMs?: number;
};

type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

export class GeminiProvider implements ModelProvider {
  readonly id = "gemini";
  readonly name = "Google Gemini";
  readonly kind = "cloud" as const;

  constructor(private readonly options: GeminiProviderOptions) {}

  async listModels(): Promise<ModelInfo[]> {
    if (!this.isConfigured()) return [];
    return [{ id: this.options.defaultModel ?? "gemini-2.5-pro", label: "Configured Gemini generateContent model" }];
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (!this.isConfigured()) {
      throw new Error("gemini is disabled because API key or base URL is missing.");
    }
    const model = req.model || this.options.defaultModel || "gemini-2.5-pro";
    const body = {
      contents: toGeminiContents(req.messages),
      generationConfig: {
        temperature: req.temperature ?? 0.2,
        maxOutputTokens: req.maxCompletionTokens ?? 1024
      }
    };
    const response = await this.fetchGenerateContent(model, body);
    if (!response.ok) {
      throw new Error(`gemini request failed: ${response.status} ${await response.text()}`);
    }
    const json = (await response.json()) as {
      responseId?: string;
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      modelVersion?: string;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
    };
    return {
      id: json.responseId ?? "gemini-response",
      model: json.modelVersion ?? model,
      content: json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "",
      usage: json.usageMetadata
        ? {
            inputTokens: json.usageMetadata.promptTokenCount ?? 0,
            outputTokens: json.usageMetadata.candidatesTokenCount ?? 0
          }
        : undefined
    };
  }

  private isConfigured(): boolean {
    return Boolean(this.options.apiKey && this.baseUrl());
  }

  private async fetchGenerateContent(model: string, body: Record<string, unknown>): Promise<Response> {
    const controller = new AbortController();
    const timeoutMs = this.options.requestTimeoutMs ?? 120_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${this.baseUrl()}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.options.apiKey ?? "",
          ...(this.options.extraHeaders ?? {})
        },
        body: JSON.stringify(body)
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`gemini request timed out after ${timeoutMs}ms.`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private baseUrl(): string {
    return (this.options.baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  }
}

export function createGeminiProvider(apiKey?: string, defaultModel?: string, baseUrl?: string, extraHeaders?: Record<string, string>): GeminiProvider {
  return new GeminiProvider({ apiKey, defaultModel, baseUrl, extraHeaders });
}

function toGeminiContents(messages: ChatMessage[]): Array<{ role: "user" | "model"; parts: GeminiPart[] }> {
  const systemText = messages.filter((message) => message.role === "system").map((message) => contentToText(message.content)).filter(Boolean).join("\n\n");
  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: toGeminiParts(message.content)
    }));
  if (systemText) {
    contents.unshift({ role: "user", parts: [{ text: `System instructions:\n${systemText}` }] });
  }
  return contents.length ? contents : [{ role: "user", parts: [{ text: "" }] }];
}

function toGeminiParts(content: ChatMessageContent): GeminiPart[] {
  if (typeof content === "string") return [{ text: content }];
  return content.map((part): GeminiPart => {
    if (part.type === "text") return { text: part.text };
    const parsed = parseDataUrl(part.image_url.url);
    return parsed ? { inline_data: { mime_type: parsed.mediaType, data: parsed.data } } : { text: `[image_url: ${part.image_url.url}]` };
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
