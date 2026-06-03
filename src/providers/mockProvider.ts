import type { ChatRequest, ChatResponse, ModelInfo, ModelProvider } from "./types.js";

export class MockProvider implements ModelProvider {
  id = "mock";
  name = "Mock Provider";
  kind = "mock" as const;

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: "mock-balanced", label: "Mock Balanced Model", contextWindow: 128000 }];
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const last = req.messages.at(-1)?.content ?? "";
    return {
      id: "mock-response",
      model: req.model,
      content: JSON.stringify({
        provider: this.id,
        model: req.model,
        summary: "Deterministic offline response",
        echo: last.slice(0, 240)
      }),
      usage: {
        inputTokens: estimateTokens(req.messages.map((m) => m.content).join("\n")),
        outputTokens: 48
      }
    };
  }
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
