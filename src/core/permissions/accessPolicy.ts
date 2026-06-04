import type { AccessMode, TomorrowEdgeConfig } from "../../config/schema.js";

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
  mode?: AccessMode;
  approvePatch?: boolean;
  approveShell?: boolean;
  approveRepair?: boolean;
};

export function buildAccessPolicy(config: TomorrowEdgeConfig, options: AccessPolicyOptions = {}): AccessPolicy {
  const mode = options.mode ?? config.project.access_mode;
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

export function describeAccessPolicy(access: AccessPolicy): string {
  if (access.mode === "full") {
    return "MODE: FULL AUTONOMY - patch, shell, and repair are auto-approved; every step is visible and logged.";
  }
  if (access.mode === "restricted") {
    return "MODE: RESTRICTED - cloud/model calls and local mutations are blocked.";
  }
  if (access.patchApproved || access.shellApproved || access.repairApproved) {
    return `MODE: PARTIAL SUPERVISION - explicit approvals: patch=${yesNo(access.patchApproved)} shell=${yesNo(access.shellApproved)} repair=${yesNo(access.repairApproved)}; unapproved actions still stop at gates.`;
  }
  return "MODE: PARTIAL SUPERVISION - patch, shell, and repair require explicit approval.";
}

function yesNo(value: boolean): "yes" | "no" {
  return value ? "yes" : "no";
}
