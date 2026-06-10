import { z } from "zod";
import type { AccessMode } from "../../config/schema.js";
import type { RiskLevel } from "../../schemas/plan.js";
import type { ScenarioType } from "../scenarios/scenarioTypes.js";

export const skillLifecycleStates = ["draft", "candidate", "validated", "stable", "deprecated", "blocked", "rejected", "rolled_back"] as const;
export type SkillLifecycleState = typeof skillLifecycleStates[number];

export const skillProvenanceValues = ["human_seeded", "agent_candidate", "imported", "recipe_derived", "tool_pack"] as const;
export type SkillProvenance = typeof skillProvenanceValues[number];

export const skillPermissionIntents = ["read", "write", "shell", "network", "database", "github_write"] as const;
export type SkillPermissionIntent = typeof skillPermissionIntents[number];

export const skillManifestSchema = z.object({
  schemaVersion: z.literal("skill-manifest/v1"),
  skillId: z.string().regex(/^[a-z][a-z0-9_.-]*$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  name: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string()).default([]),
  scenarios: z.array(z.string()).default([]),
  userStories: z.array(z.string()).default([]),
  inputs: z.array(z.string()).default([]),
  outputs: z.array(z.string()).default([]),
  requiredArtifacts: z.array(z.string()).default([]),
  verificationCommands: z.array(z.string()).default([]),
  requiredTools: z.array(z.string()).default([]),
  permissions: z.object({
    intents: z.array(z.enum(skillPermissionIntents)).default([]),
    allowedTools: z.array(z.string()).default([]),
    filesystem: z.object({
      read: z.boolean().default(false),
      write: z.boolean().default(false),
      pathScope: z.enum(["workspace", "artifact_store", "none"]).default("workspace")
    }).default({ read: false, write: false, pathScope: "workspace" }),
    shell: z.object({
      allowed: z.boolean().default(false),
      commands: z.array(z.string()).default([])
    }).default({ allowed: false, commands: [] }),
    network: z.object({
      allowed: z.boolean().default(false),
      hosts: z.array(z.string()).default([])
    }).default({ allowed: false, hosts: [] }),
    github: z.object({
      read: z.boolean().default(false),
      write: z.boolean().default(false)
    }).default({ read: false, write: false })
  }),
  allowedAccessModes: z.array(z.enum(["restricted", "partial", "full"])).default(["restricted", "partial", "full"]),
  riskLevel: z.enum(["low", "medium", "high"]),
  provenance: z.enum(skillProvenanceValues),
  lifecycle: z.enum(skillLifecycleStates),
  owner: z.string().optional(),
  sourceRecipeId: z.string().optional(),
  validationReportId: z.string().optional(),
  previousVersion: z.string().optional(),
  rollbackToVersion: z.string().optional(),
  fixtures: z.array(z.object({
    id: z.string(),
    description: z.string(),
    commands: z.array(z.string()).default([])
  })).default([]),
  sandbox: z.object({
    required: z.boolean().default(true),
    profile: z.enum(["none", "fixture", "isolated_workspace"]).default("fixture")
  }).default({ required: true, profile: "fixture" }),
  lifecycleHistory: z.array(z.object({
    from: z.enum(skillLifecycleStates).optional(),
    to: z.enum(skillLifecycleStates),
    reason: z.string(),
    actor: z.string(),
    evidenceRefs: z.array(z.string()).default([]),
    at: z.string()
  })).default([])
});

export type SkillManifestV1 = Omit<z.infer<typeof skillManifestSchema>, "scenarios" | "allowedAccessModes" | "riskLevel"> & {
  scenarios: ScenarioType[];
  allowedAccessModes: AccessMode[];
  riskLevel: RiskLevel;
};

export const skillPackManifestSchema = z.object({
  schemaVersion: z.literal("skill-pack/v1"),
  packId: z.string().regex(/^[a-z][a-z0-9_.-]*$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  name: z.string().min(1),
  description: z.string().min(1),
  kind: z.enum(["skill_pack", "tool_pack"]),
  domainTags: z.array(z.string()).default([]),
  userStories: z.array(z.string()).default([]),
  enabledByDefault: z.boolean().default(true),
  skills: z.array(skillManifestSchema)
});

export type SkillPackManifestV1 = Omit<z.infer<typeof skillPackManifestSchema>, "skills"> & {
  skills: SkillManifestV1[];
};

export type SkillValidationError = {
  path: string;
  message: string;
};

export function validateSkillManifest(value: unknown): { ok: true; manifest: SkillManifestV1 } | { ok: false; errors: SkillValidationError[] } {
  const parsed = skillManifestSchema.safeParse(value);
  if (parsed.success) return { ok: true, manifest: parsed.data as SkillManifestV1 };
  return { ok: false, errors: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) };
}

export function validateSkillPackManifest(value: unknown): { ok: true; pack: SkillPackManifestV1 } | { ok: false; errors: SkillValidationError[] } {
  const parsed = skillPackManifestSchema.safeParse(value);
  if (parsed.success) return { ok: true, pack: parsed.data as SkillPackManifestV1 };
  return { ok: false, errors: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) };
}
