import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ChatRequest, ChatResponse, ModelInfo, ModelProvider } from "./types.js";

export class FixtureProvider implements ModelProvider {
  id = "fixture";
  name = "Fixture Provider";
  kind = "mock" as const;

  constructor(private readonly fixtureDir = path.join(process.cwd(), "tests", "fixtures", "provider-responses")) {}

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: "fixture-scripted", label: "Fixture Scripted Model" }];
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const fixtureName = String(req.metadata?.fixture ?? "default") + ".json";
    const fixturePath = path.join(this.fixtureDir, fixtureName);
    const content = existsSync(fixturePath)
      ? readFileSync(fixturePath, "utf8")
      : JSON.stringify({ summary: "No fixture found; using empty scripted response." });
    return {
      id: `fixture-${fixtureName}`,
      model: req.model,
      content
    };
  }
}
