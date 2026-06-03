import { z } from "zod";

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

export const providerConfigSchema = z.object({
  enabled: z.boolean().default(false),
  api_key_env: z.string().optional(),
  base_url: z.string().default(""),
  model: z.string().default(""),
  api_format: providerApiFormatSchema.default("openai_chat"),
  auth_header: providerAuthHeaderSchema.default("bearer"),
  extra_headers: z.record(z.string()).default({})
});

export const agentConfigSchema = z.object({
  provider: z.string().default("auto"),
  model: z.string().default("auto")
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
  privacy: z.object({
    mode: z.enum(["normal", "privacy", "local"]).default("normal"),
    allow_cloud_repo_context: z.boolean().default(true),
    require_approval_for_sensitive_files: z.boolean().default(true)
  }),
  providers: z.record(providerConfigSchema),
  agents: z.record(agentConfigSchema),
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
