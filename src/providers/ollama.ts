import type { ChatRequest, ChatResponse, ModelInfo, ModelProvider } from "./types.js";

export class OllamaProvider implements ModelProvider {
  id = "ollama";
  name = "Ollama";
  kind = "local" as const;

  constructor(private readonly baseUrl = "http://localhost:11434") {}

  async listModels(): Promise<ModelInfo[]> {
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/tags`);
      if (!response.ok) return [];
      const json = (await response.json()) as { models?: Array<{ name: string }> };
      return (json.models ?? []).map((model) => ({ id: model.name, label: model.name }));
    } catch (error) {
      console.error(`[ollama] Failed to list models: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        stream: false
      })
    });
    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status} ${await response.text()}`);
    }
    const json = (await response.json()) as { message?: { content?: string } };
    return {
      id: "ollama-response",
      model: req.model,
      content: json.message?.content ?? ""
    };
  }
}
