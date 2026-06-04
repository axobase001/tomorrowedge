import type { AgentRole } from "../../schemas/agentTask.js";
import type { TomorrowEdgeConfig } from "../../config/schema.js";

export type ModelStrength =
  | "vision"
  | "ocr"
  | "perception"
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
    strengths: ["vision", "ocr", "perception", "planning", "coding", "review", "cheap", "fast", "reasoning"],
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
      model: configuredModel(config, "openrouter", "OPENROUTER_MODEL", "openai/gpt-5.2"),
      label: "OpenRouter GPT-5 class model",
      strengths: ["planning", "review", "reasoning", "coding", "long_context"],
      contextWindow: 400000,
      inputPricePerMTok: 2.5,
      outputPricePerMTok: 10,
      latencyClass: "medium",
      defaultRoles: ["planner", "reviewer", "judge"]
    });
  }
  if (config.providers.deepseek?.enabled) {
    profiles.push({
      provider: "deepseek",
      model: configuredModel(config, "deepseek", "DEEPSEEK_MODEL", "deepseek-v4-pro"),
      label: "DeepSeek coding/reasoning model",
      strengths: ["coding", "reasoning", "cheap", "fast", "multilingual"],
      contextWindow: 128000,
      inputPricePerMTok: 0.14,
      outputPricePerMTok: 0.28,
      latencyClass: "medium",
      defaultRoles: ["explorer", "coder_a", "repairer", "summarizer"]
    });
  }
  if (config.providers.mimo?.enabled) {
    profiles.push({
      provider: "mimo",
      model: configuredModel(config, "mimo", "MIMO_MODEL", "mimo-v2.5-pro"),
      label: "Xiaomi MiMo V2.5 model",
      strengths: ["vision", "ocr", "perception", "coding", "cheap", "fast", "multilingual"],
      contextWindow: 128000,
      inputPricePerMTok: 0.4,
      outputPricePerMTok: 1.6,
      latencyClass: "medium",
      defaultRoles: ["vision", "coder_b", "summarizer"]
    });
  }
  if (config.providers.openai_compatible?.enabled) {
    profiles.push({
      provider: "openai_compatible",
      model: configuredModel(config, "openai_compatible", "OPENAI_COMPATIBLE_MODEL", "configured-model"),
      label: "Generic OpenAI-compatible model",
      strengths: ["planning", "coding", "review", "reasoning"],
      inputPricePerMTok: 0.15,
      outputPricePerMTok: 0.6,
      contextWindow: 128000,
      latencyClass: "medium",
      defaultRoles: ["planner", "coder_a", "reviewer"]
    });
  }
  if (config.providers.kimi?.enabled) {
    profiles.push({
      provider: "kimi",
      model: configuredModel(config, "kimi", "KIMI_MODEL", "kimi-k2.6"),
      label: "Kimi-compatible long-context model",
      strengths: ["long_context", "coding", "reasoning", "multilingual", "cheap"],
      inputPricePerMTok: 0.5,
      outputPricePerMTok: 2,
      contextWindow: 128000,
      latencyClass: "medium",
      defaultRoles: ["explorer", "coder_b", "summarizer"]
    });
  }
  if (config.providers.anthropic?.enabled) {
    profiles.push({
      provider: "anthropic",
      model: configuredModel(config, "anthropic", "ANTHROPIC_MODEL", "claude-sonnet-4-5"),
      label: "Anthropic Claude native Messages model",
      strengths: ["planning", "review", "reasoning", "coding", "long_context", "vision"],
      inputPricePerMTok: 3,
      outputPricePerMTok: 15,
      contextWindow: 200000,
      latencyClass: "medium",
      defaultRoles: ["core", "planner", "reviewer", "judge"]
    });
  }
  if (config.providers.gemini?.enabled) {
    profiles.push({
      provider: "gemini",
      model: configuredModel(config, "gemini", "GEMINI_MODEL", "gemini-2.5-pro"),
      label: "Google Gemini native generateContent model",
      strengths: ["vision", "perception", "planning", "review", "reasoning", "long_context", "multilingual"],
      inputPricePerMTok: 1.25,
      outputPricePerMTok: 10,
      contextWindow: 1000000,
      latencyClass: "medium",
      defaultRoles: ["vision", "planner", "reviewer"]
    });
  }
  if (config.providers.ollama?.enabled) {
    profiles.push({
      provider: "ollama",
      model: configuredModel(config, "ollama", "OLLAMA_MODEL", "local-auto"),
      label: "Configured local Ollama model",
      strengths: ["local", "privacy"],
      defaultRoles: ["explorer", "coder_a", "repairer", "summarizer"]
    });
  }
  return [...profiles, ...editableDefaultProfiles];
}

function configuredModel(config: TomorrowEdgeConfig, provider: string, envName: string, fallback: string): string {
  const fromConfig = config.providers[provider]?.model?.trim();
  if (fromConfig) return fromConfig;
  const fromEnv = process.env[envName]?.trim();
  return fromEnv || fallback;
}
