import type { AgentRole } from "../../schemas/agentTask.js";
import type { TomorrowEdgeConfig } from "../../config/schema.js";

export type ModelStrength =
  | "planning"
  | "coding"
  | "review"
  | "long_context"
  | "cheap"
  | "fast"
  | "local"
  | "privacy"
  | "multilingual"
  | "reasoning";

export type ModelProfile = {
  provider: string;
  model: string;
  label: string;
  strengths: ModelStrength[];
  contextWindow?: number;
  inputPricePerMTok?: number;
  outputPricePerMTok?: number;
  latencyClass?: "low" | "medium" | "high";
  defaultRoles?: AgentRole[];
};

export const editableDefaultProfiles: ModelProfile[] = [
  {
    provider: "mock",
    model: "mock-balanced",
    label: "Mock balanced offline model",
    strengths: ["planning", "coding", "review", "cheap", "fast", "reasoning"],
    contextWindow: 128000
  },
  {
    provider: "fixture",
    model: "fixture-scripted",
    label: "Fixture scripted offline model",
    strengths: ["cheap", "fast"],
    contextWindow: 32000
  },
  {
    provider: "ollama",
    model: "local-auto",
    label: "Local Ollama model",
    strengths: ["local", "privacy"],
    defaultRoles: ["explorer", "coder_a", "repairer", "summarizer"]
  }
];

export function profilesFromConfig(config: TomorrowEdgeConfig): ModelProfile[] {
  const profiles: ModelProfile[] = [];
  if (config.providers.openrouter?.enabled) {
    profiles.push({
      provider: "openrouter",
      model: process.env.OPENROUTER_MODEL ?? "openai/gpt-5.2",
      label: "OpenRouter GPT-5 class model",
      strengths: ["planning", "review", "reasoning", "coding", "long_context"],
      contextWindow: 400000,
      latencyClass: "medium",
      defaultRoles: ["planner", "reviewer", "judge"]
    });
  }
  if (config.providers.deepseek?.enabled) {
    profiles.push({
      provider: "deepseek",
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-pro",
      label: "DeepSeek coding/reasoning model",
      strengths: ["coding", "reasoning", "cheap", "fast", "multilingual"],
      contextWindow: 128000,
      latencyClass: "medium",
      defaultRoles: ["explorer", "coder_a", "repairer", "summarizer"]
    });
  }
  if (config.providers.mimo?.enabled) {
    profiles.push({
      provider: "mimo",
      model: process.env.MIMO_MODEL ?? "mimo-v2.5-pro",
      label: "Xiaomi MiMo V2.5 model",
      strengths: ["coding", "cheap", "fast", "multilingual"],
      contextWindow: 128000,
      latencyClass: "medium",
      defaultRoles: ["coder_b", "summarizer"]
    });
  }
  return [...profiles, ...editableDefaultProfiles];
}
