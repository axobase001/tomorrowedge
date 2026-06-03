import { execa } from "execa";
import type { RunResult } from "../../schemas/evidence.js";

export async function runApprovedCommand(cwd: string, command: string, approved: boolean): Promise<RunResult> {
  if (!approved) {
    throw new Error("Shell command blocked: approval required.");
  }
  const start = Date.now();
  const subprocess = await execa(command, {
    cwd,
    shell: true,
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
