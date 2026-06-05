import { z } from "zod";
import { agentRoles } from "../schemas/agentTask.js";

export const routingModeSchema = z.enum(["cheap", "balanced", "quality", "local", "privacy", "china"]);
export type RoutingMode = z.infer<typeof routingModeSchema>;
export const accessModeSchema = z.enum(["restricted", "partial", "full"]);
export type AccessMode = z.infer<typeof accessModeSchema>;
export const providerApiFormatSchema = z.enum(["openai_chat", "legacy_chat"]);
export type ProviderApiFormat = z.infer<typeof providerApiFormatSchema>;
export const providerAuthHeaderSchema = z.enum(["bearer", "api-key", "none"]);
export type ProviderAuthHeader = z.infer<typeof providerAuthHeaderSchema>;
export const orchestrationBackendSchema = z.enum(["native", "langgraph", "crewai", "autogen"]);
export type OrchestrationBackendName = z.infer<typeof orchestrationBackendSchema>;
export const shellPolicySchema = z.enum(["unrestricted", "verification_allowlist", "approval_required"]);
export type ShellPolicy = z.infer<typeof shellPolicySchema>;
export const externalAgentTransportSchema = z.enum(["mcp"]);
export const externalAgentTrustLevelSchema = z.enum(["low", "medium", "high", "owner"]);
export const agentRoleSchema = z.enum(agentRoles);

export const providerConfigSchema = z.object({
  enabled: z.boolean().default(false),
  api_key_env: z.string().optional(),
  base_url: z.string().default(""),
  model: z.string().default(""),
  api_format: providerApiFormatSchema.default("openai_chat"),
  auth_header: providerAuthHeaderSchema.default("bearer"),
  extra_headers: z.record(z.string()).default({})
});
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export const agentConfigSchema = z.object({
  provider: z.string().default("auto"),
  model: z.string().default("auto")
});

export const externalAgentConfigSchema = z.object({
  enabled: z.boolean().default(false),
  name: z.string().optional(),
  transport: externalAgentTransportSchema.default("mcp"),
  command: z.string().default(""),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  env: z.record(z.string()).default({}),
  proxyPort: z.number().int().min(1).max(65_535).optional(),
  autoStart: z.boolean().default(false),
  startupTimeoutMs: z.number().int().positive().default(10_000),
  requestTimeoutMs: z.number().int().positive().default(60_000),
  maxRetries: z.number().int().nonnegative().default(1),
  capabilities: z.array(z.string()).default([]),
  roles: z.array(agentRoleSchema).default([]),
  trustLevel: externalAgentTrustLevelSchema.default("medium"),
  costProfile: z.record(z.unknown()).optional(),
  notes: z.string().optional()
});

export const orchestrationAdapterConfigSchema = z.object({
  enabled: z.boolean().default(false),
  module: z.string().default(""),
  entrypoint: z.string().default(""),
  options: z.record(z.unknown()).default({})
});

export const mcpToolAdapterConfigSchema = z.object({
  enabled: z.boolean().default(false),
  servers: z.array(z.string()).default([]),
  exposeToolsToBackend: z.boolean().default(false)
});

export const configSchema = z.object({
  project: z.object({
    name: z.string().default("tomorrowedge"),
    language: z.string().default("zh-CN"),
    access_mode: accessModeSchema.default("partial"),
    safe_mode: z.boolean().default(true),
    telemetry: z.boolean().default(false)
  }),
  routing: z.object({
    mode: routingModeSchema.default("balanced"),
    fallback: z.boolean().default(true),
    max_cost_usd: z.number().nonnegative().default(1),
    max_wall_time_sec: z.number().positive().default(600)
  }),
  model_discovery: z.object({
    recommended_provider: z.string().default("openrouter"),
    refresh_free_models: z.boolean().default(true),
    prefer_free_onboarding: z.boolean().default(true),
    free_model_limit: z.number().int().min(1).max(50).default(10)
  }).default({
    recommended_provider: "openrouter",
    refresh_free_models: true,
    prefer_free_onboarding: true,
    free_model_limit: 10
  }),
  autonomy: z.object({
    max_iterations: z.number().int().positive().default(5),
    max_repairs: z.number().int().nonnegative().default(3),
    max_shell_runs: z.number().int().nonnegative().default(10),
    max_cost_usd: z.number().nonnegative().default(10),
    max_wall_time_sec: z.number().positive().default(1800)
  }),
  budget: z.object({
    hard_cap_usd: z.number().nonnegative().default(10),
    warn_at_percent: z.number().min(1).max(100).default(80)
  }),
  memory: z.object({
    strategy_routing: z.boolean().default(false),
    history_limit: z.number().int().min(1).max(200).default(50)
  }).default({
    strategy_routing: false,
    history_limit: 50
  }),
  strong_agents: z.object({
    max_calls_per_task: z.number().int().nonnegative().default(3),
    max_cost_usd: z.number().nonnegative().default(2),
    reserve_for_roles: z.array(agentRoleSchema).default(["planner", "reviewer", "judge"]),
    escalate_on: z.array(z.string()).default(["high_risk_patch", "repeated_test_failure", "reviewer_disagreement", "security_sensitive_change"])
  }).default({
    max_calls_per_task: 3,
    max_cost_usd: 2,
    reserve_for_roles: ["planner", "reviewer", "judge"],
    escalate_on: ["high_risk_patch", "repeated_test_failure", "reviewer_disagreement", "security_sensitive_change"]
  }),
  privacy: z.object({
    mode: z.enum(["normal", "privacy", "local"]).default("normal"),
    allow_cloud_repo_context: z.boolean().default(true),
    require_approval_for_sensitive_files: z.boolean().default(true)
  }),
  shell: z.object({
    policy: shellPolicySchema.optional(),
    verification_allowlist: z.array(z.string()).default(["npm", "node", "npx", "pnpm", "yarn", "python", "python3", "pytest", "tsx", "tsc", "vitest", "jest", "cargo", "rustc", "make", "cmake", "go", "uv", "pip", "bun", "deno"])
  }).default({ policy: undefined, verification_allowlist: ["npm", "node", "npx", "pnpm", "yarn", "python", "python3", "pytest", "tsx", "tsc", "vitest", "jest", "cargo", "rustc", "make", "cmake", "go", "uv", "pip", "bun", "deno"] }),
  providers: z.record(providerConfigSchema),
  agents: z.record(agentConfigSchema),
  external_agents: z.record(externalAgentConfigSchema).default({}),
  orchestration: z.object({
    backend: orchestrationBackendSchema.default("native"),
    langgraph: orchestrationAdapterConfigSchema.default({}),
    crewai: orchestrationAdapterConfigSchema.default({}),
    autogen: orchestrationAdapterConfigSchema.default({}),
    mcp_tools: mcpToolAdapterConfigSchema.default({})
  }),
  debate: z.object({
    enabled: z.boolean().default(true),
    max_candidates: z.number().int().min(1).max(4).default(2),
    max_rounds: z.number().int().min(0).max(5).default(1),
    max_cost_usd: z.number().nonnegative().default(1),
    max_wall_time_sec: z.number().positive().default(300)
  }),
  safety: z.object({
    exclude: z.array(z.string()).default([])
  })
});

export type TomorrowEdgeConfig = z.infer<typeof configSchema>;
