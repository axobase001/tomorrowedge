import type { TomorrowEdgeConfig } from "./schema.js";

export const defaultConfig: TomorrowEdgeConfig = {
  project: {
    name: "tomorrowedge",
    language: "zh-CN",
    access_mode: "partial",
    safe_mode: true,
    telemetry: false
  },
  routing: {
    mode: "balanced",
    fallback: true,
    max_cost_usd: 1,
    max_wall_time_sec: 600
  },
  privacy: {
    mode: "normal",
    allow_cloud_repo_context: true,
    require_approval_for_sensitive_files: true
  },
  providers: {
    mock: { enabled: true, base_url: "" },
    fixture: { enabled: true, base_url: "" },
    openrouter: {
      enabled: false,
      api_key_env: "OPENROUTER_API_KEY",
      base_url: "https://openrouter.ai/api/v1"
    },
    mimo: { enabled: false, api_key_env: "MIMO_API_KEY", base_url: "" },
    openai_compatible: { enabled: false, api_key_env: "OPENAI_API_KEY", base_url: "" },
    deepseek: { enabled: false, api_key_env: "DEEPSEEK_API_KEY", base_url: "" },
    kimi: { enabled: false, api_key_env: "KIMI_API_KEY", base_url: "" },
    anthropic: { enabled: false, api_key_env: "ANTHROPIC_API_KEY", base_url: "" },
    gemini: { enabled: false, api_key_env: "GEMINI_API_KEY", base_url: "" },
    ollama: { enabled: true, base_url: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434" }
  },
  agents: {
    planner: { model: "auto" },
    explorer: { model: "auto" },
    coder_a: { model: "auto" },
    coder_b: { model: "auto" },
    reviewer: { model: "auto" },
    judge: { model: "auto" },
    repairer: { model: "auto" },
    summarizer: { model: "auto" }
  },
  debate: {
    enabled: true,
    max_candidates: 2,
    max_rounds: 1,
    max_cost_usd: 1,
    max_wall_time_sec: 300
  },
  safety: {
    exclude: [
      ".env",
      ".env.*",
      "node_modules/**",
      ".git/**",
      "dist/**",
      "build/**",
      "coverage/**",
      "*.pem",
      "*.key",
      "*.sqlite",
      "*.db"
    ]
  }
};
