export type ProviderKind = "cloud" | "local" | "mock";

export type ModelInfo = {
  id: string;
  label: string;
  contextWindow?: number;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: ChatMessageContent;
};

export type ChatMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } }
    >;

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxCompletionTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  responseFormat?: { type: "text" | "json_object" };
  metadata?: Record<string, unknown>;
};

export type ChatResponse = {
  id: string;
  model: string;
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
};

export type ChatDelta = {
  content: string;
};

export type CostEstimate = {
  inputUsd: number;
  outputUsd: number;
  totalUsd: number;
};

export interface ModelProvider {
  id: string;
  name: string;
  kind: ProviderKind;
  listModels(): Promise<ModelInfo[]>;
  chat(req: ChatRequest): Promise<ChatResponse>;
  stream?(req: ChatRequest): AsyncIterable<ChatDelta>;
  estimateCost?(req: ChatRequest, model: string): Promise<CostEstimate>;
}
