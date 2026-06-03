import { z } from "zod";

export const routingModeSchema = z.enum(["cheap", "balanced", "quality", "local", "privacy", "china"]);
export type RoutingMode = z.infer<typeof routingModeSchema>;
export const accessModeSchema = z.enum(["restricted", "partial", "full"]);
export type AccessMode = z.infer<typeof accessModeSchema>;

export const providerConfigSchema = z.object({
  enabled: z.boolean().default(false),
  api_key_env: z.string().optional(),
  base_url: z.string().default("")
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
  privacy: z.object({
    mode: z.enum(["normal", "privacy", "local"]).default("normal"),
    allow_cloud_repo_context: z.boolean().default(true),
    require_approval_for_sensitive_files: z.boolean().default(true)
  }),
  providers: z.record(providerConfigSchema),
  agents: z.record(z.object({ model: z.string().default("auto") })),
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
