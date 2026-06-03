import type { RunResult } from "../../schemas/evidence.js";
import { runApprovedCommand } from "../tools/shellTool.js";

export async function runTestCommand(cwd: string, command: string, approved: boolean): Promise<RunResult> {
  return runApprovedCommand(cwd, command, approved);
}
