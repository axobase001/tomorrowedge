import { execa } from "execa";
import type { RunResult } from "../../schemas/evidence.js";
import { assessShellCommand } from "../../safety/shellGuard.js";

export async function runApprovedCommand(cwd: string, command: string, approved: boolean): Promise<RunResult> {
  if (!approved) {
    throw new Error("Shell command blocked: approval required.");
  }
  const risk = assessShellCommand(command);
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
