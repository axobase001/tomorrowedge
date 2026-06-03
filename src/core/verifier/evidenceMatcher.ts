import type { RunResult } from "../../schemas/evidence.js";

export function evidenceFromRun(result: RunResult): string {
  return result.success ? `Command passed: ${result.command}` : `Command failed: ${result.command} (exit ${result.exitCode})`;
}
