import { accessModeSchema, type AccessMode, type TomorrowEdgeConfig } from "../../config/schema.js";

export type AccessPolicy = {
  mode: AccessMode;
  cloudAllowed: boolean;
  patchAllowed: boolean;
  shellAllowed: boolean;
  repairAllowed: boolean;
  patchApproved: boolean;
  shellApproved: boolean;
  repairApproved: boolean;
};

export type AccessPolicyOptions = {
  mode?: string;
  approvePatch?: boolean;
  approveShell?: boolean;
  approveRepair?: boolean;
};

export function parseAccessMode(mode: string | undefined): AccessMode | undefined {
  if (mode === undefined) return undefined;
  const parsed = accessModeSchema.safeParse(mode);
  if (!parsed.success) {
    throw new Error(`Invalid access mode: ${mode}. Use restricted, partial, or full.`);
  }
  return parsed.data;
}

export function buildAccessPolicy(config: TomorrowEdgeConfig, options: AccessPolicyOptions = {}): AccessPolicy {
  const mode = parseAccessMode(options.mode) ?? config.project.access_mode;
  if (mode === "restricted") {
    return {
      mode,
      cloudAllowed: false,
      patchAllowed: false,
      shellAllowed: false,
      repairAllowed: false,
      patchApproved: false,
      shellApproved: false,
      repairApproved: false
    };
  }
  if (mode === "full") {
    return {
      mode,
      cloudAllowed: true,
      patchAllowed: true,
      shellAllowed: true,
      repairAllowed: true,
      patchApproved: true,
      shellApproved: true,
      repairApproved: true
    };
  }
  return {
    mode,
    cloudAllowed: true,
    patchAllowed: true,
    shellAllowed: true,
    repairAllowed: true,
    patchApproved: Boolean(options.approvePatch),
    shellApproved: Boolean(options.approveShell),
    repairApproved: Boolean(options.approveRepair)
  };
}
