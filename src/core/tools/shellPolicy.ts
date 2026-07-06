import type { ShellPolicy } from "../../config/schema.js";

export function effectiveShellPolicy(policy: ShellPolicy | undefined): ShellPolicy {
  return policy ?? "verification_allowlist";
}
