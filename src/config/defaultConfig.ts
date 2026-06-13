import type { TomorrowEdgeConfig } from "./schema.js";

const providerRuntimeDefaults = { requestTimeoutMs: 60_000, maxRetries: 1, retryBaseDelayMs: 1000 };

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
  strong_agents: {
    max_calls_per_task: 3,
    max_cost_usd: 2,
    reserve_for_roles: ["planner", "reviewer", "judge"],
    escalate_on: ["high_risk_patch", "repeated_test_failure", "reviewer_disagreement", "security_sensitive_change"]
  },
  strategy_memory: {
    enabled: false,
    max_records: 20,
    policy: "balanced",
    prefer_successful_routes: true,
    suggest_test_command: true,
    failure_premortem: true,
    coder_constraints: true,
    review_guard: true,
    repair_context: true
  },
  self_iterating_orchestration: {
    enabled: true,
    mode: "trace_guided",
    allow_policy_mutation: false,
    allow_offline_evolution: true,
    max_policy_variants: 15,
    elite_retention: 2
  },
  failure_memory: {
    enabled: false,
    storage_scope: "project",
    redaction: "metadata_only",
    retention_days: 30
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
    mock: { ...providerRuntimeDefaults, enabled: true, base_url: "", model: "mock-balanced", models: [{ id: "mock-balanced", label: "Mock balanced" }], api_format: "openai_chat", auth_header: "none", extra_headers: {} },
    fixture: { ...providerRuntimeDefaults, enabled: true, base_url: "", model: "fixture-scripted", models: [{ id: "fixture-scripted", label: "Fixture scripted" }], api_format: "openai_chat", auth_header: "none", extra_headers: {} },
    openrouter: {
      ...providerRuntimeDefaults,
      enabled: false,
      api_key_env: "OPENROUTER_API_KEY",
      base_url: "https://openrouter.ai/api/v1",
      model: "openai/gpt-5.2",
      models: [
        { id: "openai/gpt-5.2", label: "GPT-5.2" },
        { id: "moonshotai/kimi-k2.6:free", label: "Kimi K2.6 free" },
        { id: "qwen/qwen3-coder:free", label: "Qwen3 Coder free" },
        { id: "deepseek/deepseek-chat-v3-0324:free", label: "DeepSeek V3 free" }
      ],
      api_format: "openai_chat",
      auth_header: "bearer",
      extra_headers: {}
    },
    mimo: { ...providerRuntimeDefaults, enabled: false, api_key_env: "MIMO_API_KEY", base_url: "https://token-plan-sgp.xiaomimimo.com/v1", model: "mimo-v2.5-pro", models: [{ id: "mimo-v2.5-pro", label: "MiMo V2.5 Pro" }], api_format: "openai_chat", auth_header: "api-key", extra_headers: {} },
    openai_compatible: { ...providerRuntimeDefaults, enabled: false, api_key_env: "OPENAI_API_KEY", base_url: "https://api.openai.com/v1", model: "gpt-4o-mini", models: [{ id: "gpt-4o-mini", label: "GPT-4o mini" }], api_format: "openai_chat", auth_header: "bearer", extra_headers: {} },
    deepseek: { ...providerRuntimeDefaults, enabled: false, api_key_env: "DEEPSEEK_API_KEY", base_url: "https://api.deepseek.com", model: "deepseek-v4-pro", models: [{ id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" }, { id: "deepseek-chat", label: "DeepSeek Chat" }, { id: "deepseek-reasoner", label: "DeepSeek Reasoner" }], api_format: "openai_chat", auth_header: "bearer", extra_headers: {} },
    kimi: { ...providerRuntimeDefaults, enabled: false, api_key_env: "KIMI_API_KEY", base_url: "https://api.moonshot.ai/v1", model: "kimi-k2.6", models: [{ id: "kimi-k2.6", label: "Kimi K2.6" }, { id: "kimi-k2-0711-preview", label: "Kimi K2 preview" }], api_format: "openai_chat", auth_header: "bearer", extra_headers: {} },
    anthropic: { ...providerRuntimeDefaults, enabled: false, api_key_env: "ANTHROPIC_API_KEY", base_url: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5", models: [{ id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" }, { id: "claude-opus-4.1", label: "Claude Opus 4.1" }], api_format: "legacy_chat", auth_header: "api-key", extra_headers: {} },
    gemini: { ...providerRuntimeDefaults, enabled: false, api_key_env: "GEMINI_API_KEY", base_url: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-pro", models: [{ id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" }, { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }], api_format: "openai_chat", auth_header: "api-key", extra_headers: {} },
    ollama: { ...providerRuntimeDefaults, enabled: true, base_url: "http://localhost:11434", model: "local-auto", models: [{ id: "local-auto", label: "Local auto" }, { id: "qwen2.5-coder", label: "Qwen2.5 Coder" }, { id: "deepseek-r1", label: "DeepSeek R1" }], api_format: "openai_chat", auth_header: "none", extra_headers: {} }
  },
  external_agents: {
    claude_code: {
      enabled: false,
      name: "Claude Code",
      transport: "mcp",
      adapter: "claude_code",
      responseMode: "json",
      strictJson: true,
      workingTreeMode: "patch_proposal",
      normalizationStrictness: "strict",
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
      adapter: "codex",
      responseMode: "json",
      strictJson: true,
      workingTreeMode: "patch_proposal",
      normalizationStrictness: "strict",
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
  agent_capabilities: {},
  chief_agent: {
    id: "",
    provider: "",
    model: undefined,
    adapterId: undefined,
    roles: ["lead_planner", "architecture_reviewer", "final_judge", "final_code_review"],
    trustLevel: "high",
    costTier: "expensive",
    fallbackAgentId: undefined
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
