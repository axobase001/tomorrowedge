export type PermissionKind = "read_file" | "write_file" | "apply_patch" | "run_shell" | "send_cloud_context";

export type PermissionRequest = {
  kind: PermissionKind;
  summary: string;
  risk: "low" | "medium" | "high";
  target?: string;
};

export type PermissionDecision = {
  approved: boolean;
  reason: string;
};
