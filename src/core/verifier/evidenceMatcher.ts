import type { RunResult } from "../../schemas/evidence.js";

export function evidenceFromRun(result: RunResult): string {
  if (result.skipped) return `Command skipped: ${result.command} (${result.skipReason ?? "not applicable"})`;
  return result.success ? `Command passed: ${result.command}` : `Command failed: ${result.command} (exit ${result.exitCode})`;
}
