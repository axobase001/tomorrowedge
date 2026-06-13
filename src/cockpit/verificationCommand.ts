import type { AgentGraphState } from "../core/agentGraph/state.js";
import type { PatchCandidate } from "../schemas/patchCandidate.js";
import { assessShellCommand } from "../safety/shellGuard.js";

export function resolveCockpitShellCommand(state: AgentGraphState): string | undefined {
  const selected = selectedCandidate(state);
  const candidateCommand = selected ? commandFromCandidateTestPlan(selected, state.changedFiles) : undefined;
  return candidateCommand ?? firstSafeCommand(state.plan?.verificationCommands ?? []);
}

function commandFromCandidateTestPlan(candidate: PatchCandidate, changedFiles: string[]): string | undefined {
  const related = new Set([...candidate.filesChanged, ...changedFiles].map(normalizePath));
  const commands = candidate.testPlan.flatMap(extractCommandCandidates);
  return commands.find((command) => isSafeCommand(command) && commandMatchesChangedFiles(command, related))
    ?? commands.find((command) => isSafeCommand(command) && isFocusedCommand(command));
}

function firstSafeCommand(commands: string[]): string | undefined {
  return commands.find((command) => isSafeCommand(command));
}

function extractCommandCandidates(value: string): string[] {
  const candidates: string[] = [];
  for (const match of value.matchAll(/`([^`\n]+)`/g)) {
    candidates.push(match[1].trim());
  }
  const trimmed = value.trim();
  if (!candidates.length && looksLikeCommand(trimmed)) candidates.push(trimmed);
  return unique(candidates);
}

function looksLikeCommand(value: string): boolean {
  return /^(npm|node|npx|pnpm|yarn|python|python3|pytest|tsx|tsc|vitest|jest|cargo|rustc|make|cmake|go|uv|pip|bun|deno)\b/.test(value);
}

function isSafeCommand(command: string): boolean {
  return assessShellCommand(command).allowed;
}

function isFocusedCommand(command: string): boolean {
  const risk = assessShellCommand(command);
  if (!risk.allowed || !risk.argv?.length) return false;
  const executable = risk.argv[0].toLowerCase();
  if ((executable === "python" || executable === "python3") && risk.argv.some((arg) => /\.py$/i.test(arg))) return true;
  if (["node", "tsx", "deno", "bun"].includes(executable) && risk.argv.some((arg) => /\.(mjs|cjs|js|jsx|ts|tsx)$/i.test(arg))) return true;
  if (["go", "cargo", "pytest", "vitest", "jest"].includes(executable) && risk.argv.length > 1) return true;
  return false;
}

function commandMatchesChangedFiles(command: string, changedFiles: Set<string>): boolean {
  if (!changedFiles.size) return false;
  const normalizedCommand = normalizePath(command);
  for (const file of changedFiles) {
    if (normalizedCommand.includes(file)) return true;
  }
  return false;
}

function selectedCandidate(state: AgentGraphState): PatchCandidate | undefined {
  const pendingRepair = state.repairCandidates.at(-1);
  if (pendingRepair && state.agents.some((agent) => agent.status === "waiting_for_user" && agent.role === "runner")) return pendingRepair;
  const candidates = [...state.candidates, ...state.repairCandidates];
  return candidates.find((candidate) => candidate.candidateId === state.judge?.selectedCandidateId) ?? candidates[0];
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").trim().toLowerCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
