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
  model_discovery: {
    recommended_provider: "openrouter",
    refresh_free_models: true,
    prefer_free_onboarding: true,
    free_model_limit: 10
  },
  autonomy: {
    max_iterations: 5,
    max_repairs: 3,
    max_shell_runs: 10,
    max_cost_usd: 10,
    max_wall_time_sec: 1800
  },
  budget: {
    hard_cap_usd: 10,
    warn_at_percent: 80
  },
  privacy: {
    mode: "normal",
    allow_cloud_repo_context: true,
    require_approval_for_sensitive_files: true
  },
  shell: {
    policy: undefined,
    verification_allowlist: ["npm", "node", "npx", "pnpm", "yarn", "python", "python3", "pytest", "tsx", "tsc", "vitest", "jest", "cargo", "rustc", "make", "cmake", "go", "uv", "pip", "bun", "deno"]
  },
  providers: {
    mock: { enabled: true, base_url: "", model: "mock-balanced", api_format: "openai_chat", auth_header: "none", extra_headers: {} },
    fixture: { enabled: true, base_url: "", model: "fixture-scripted", api_format: "openai_chat", auth_header: "none", extra_headers: {} },
    openrouter: {
      enabled: false,
      api_key_env: "OPENROUTER_API_KEY",
      base_url: "https://openrouter.ai/api/v1",
      model: "openai/gpt-5.2",
      api_format: "openai_chat",
      auth_header: "bearer",
      extra_headers: {}
    },
    mimo: { enabled: false, api_key_env: "MIMO_API_KEY", base_url: "", model: "mimo-v2.5-pro", api_format: "openai_chat", auth_header: "api-key", extra_headers: {} },
    openai_compatible: { enabled: false, api_key_env: "OPENAI_API_KEY", base_url: "", model: "gpt-4o-mini", api_format: "openai_chat", auth_header: "bearer", extra_headers: {} },
    deepseek: { enabled: false, api_key_env: "DEEPSEEK_API_KEY", base_url: "", model: "deepseek-v4-pro", api_format: "openai_chat", auth_header: "bearer", extra_headers: {} },
    kimi: { enabled: false, api_key_env: "KIMI_API_KEY", base_url: "https://api.moonshot.ai/v1", model: "kimi-k2.6", api_format: "openai_chat", auth_header: "bearer", extra_headers: {} },
    anthropic: { enabled: false, api_key_env: "ANTHROPIC_API_KEY", base_url: "", model: "claude-opus-4.1", api_format: "legacy_chat", auth_header: "bearer", extra_headers: {} },
    gemini: { enabled: false, api_key_env: "GEMINI_API_KEY", base_url: "", model: "gemini-2.5-pro", api_format: "openai_chat", auth_header: "bearer", extra_headers: {} },
    ollama: { enabled: true, base_url: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434", model: "local-auto", api_format: "openai_chat", auth_header: "none", extra_headers: {} }
  },
  external_agents: {
    claude_code: {
      enabled: false,
      name: "Claude Code",
      transport: "mcp",
      command: "",
      args: [],
      cwd: undefined,
      env: {},
      autoStart: false,
      startupTimeoutMs: 10_000,
      requestTimeoutMs: 60_000,
      maxRetries: 1,
      capabilities: ["core", "planning", "review", "judgment", "coding"],
      roles: ["core", "planner", "reviewer", "judge"],
      trustLevel: "high",
      notes: "Mock MCP bridge profile; real Claude Code invocation is configured by the user."
    },
    codex: {
      enabled: false,
      name: "Codex",
      transport: "mcp",
      command: "",
      args: [],
      cwd: undefined,
      env: {},
      autoStart: false,
      startupTimeoutMs: 10_000,
      requestTimeoutMs: 60_000,
      maxRetries: 1,
      capabilities: ["core", "coding", "repair", "review", "tool_use"],
      roles: ["core", "coder_a", "repairer", "reviewer"],
      trustLevel: "high",
      notes: "Mock MCP bridge profile; real Codex invocation is configured by the user."
    }
  },
  agents: {
    vision: { provider: "auto", model: "auto" },
    planner: { provider: "auto", model: "auto" },
    explorer: { provider: "auto", model: "auto" },
    coder_a: { provider: "auto", model: "auto" },
    coder_b: { provider: "auto", model: "auto" },
    reviewer: { provider: "auto", model: "auto" },
    judge: { provider: "auto", model: "auto" },
    repairer: { provider: "auto", model: "auto" },
    summarizer: { provider: "auto", model: "auto" }
  },
  orchestration: {
    backend: "native",
    langgraph: { enabled: false, module: "", entrypoint: "", options: {} },
    crewai: { enabled: false, module: "", entrypoint: "", options: {} },
    autogen: { enabled: false, module: "", entrypoint: "", options: {} },
    mcp_tools: { enabled: false, servers: [], exposeToolsToBackend: false }
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
      ".tomorrowedge/**",
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
