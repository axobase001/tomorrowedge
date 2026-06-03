import type { ChatRequest, ChatResponse, ModelInfo, ModelProvider, ProviderKind } from "./types.js";

export class PlaceholderProvider implements ModelProvider {
  kind: ProviderKind = "cloud";

  constructor(
    readonly id: string,
    readonly name: string,
    private readonly defaultModel: string,
    private readonly reason: string
  ) {}

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: this.defaultModel, label: `${this.name} placeholder` }];
  }

  async chat(_req: ChatRequest): Promise<ChatResponse> {
    throw new Error(`${this.name} is configured as a placeholder: ${this.reason}`);
  }
}
