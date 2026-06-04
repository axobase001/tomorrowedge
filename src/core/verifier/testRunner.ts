import type { RunResult } from "../../schemas/evidence.js";
import { runApprovedCommand, type ShellExecutionOptions } from "../tools/shellTool.js";

export async function runTestCommand(cwd: string, command: string, approvedOrOptions: boolean | ShellExecutionOptions): Promise<RunResult> {
  return runApprovedCommand(cwd, command, approvedOrOptions);
}
