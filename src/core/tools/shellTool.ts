import { execa } from "execa";
import type { RunResult } from "../../schemas/evidence.js";
import type { ShellPolicy } from "../../config/schema.js";
import { explainShellCommand } from "../../safety/shellGuard.js";

export type ShellExecutionOptions = {
  approved: boolean;
  policy?: ShellPolicy;
  verificationAllowlist?: string[];
};

export async function runApprovedCommand(cwd: string, command: string, approvedOrOptions: boolean | ShellExecutionOptions): Promise<RunResult> {
  const options: ShellExecutionOptions = typeof approvedOrOptions === "boolean" ? { approved: approvedOrOptions, policy: "verification_allowlist" } : approvedOrOptions;
  if (!options.approved) {
    throw new Error("Shell command blocked: approval required.");
  }
  const risk = explainShellCommand(command, options.verificationAllowlist, options.policy === "verification_allowlist");
  if (!risk.allowed || !risk.argv?.length) {
    throw new Error(`Shell command blocked: ${risk.reason}.`);
  }
  const start = Date.now();
  const [file, ...args] = risk.argv;
  const subprocess = await execa(file, args, {
    cwd,
    shell: false,
    preferLocal: true,
    reject: false,
    timeout: 10 * 60 * 1000
  });
  return {
    command,
    exitCode: subprocess.exitCode ?? 1,
    stdout: subprocess.stdout,
    stderr: subprocess.stderr,
    durationMs: Date.now() - start,
    success: subprocess.exitCode === 0
  };
}
