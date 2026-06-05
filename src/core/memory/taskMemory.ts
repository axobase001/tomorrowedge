import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentGraphState } from "../agentGraph/state.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import { classifyProviderError, type ProviderErrorCategory } from "../../safety/providerRedaction.js";

export type TaskMemory = {
  preferredTestCommands: string[];
  commonConstraints: string[];
  routingPreference?: string;
};

export type LearnedRouteAssignment = {
  role: AgentRole;
  provider: string;
  model: string;
};

export type LearnedProviderOutcome = LearnedRouteAssignment & {
  status: "success" | "failure";
  errorCategory?: ProviderErrorCategory;
};

export type LearnedTaskMemory = {
  createdAt: string;
  goalFingerprint: string;
  taskType: string;
  riskLevel: string;
  routingMode: string;
  accessMode: string;
  visualPageType?: string;
  capabilitySummary?: string;
  constraints: string[];
  verificationCommands: string[];
  routingAssignments?: LearnedRouteAssignment[];
  providerOutcomes?: LearnedProviderOutcome[];
  selectedCandidate?: string;
  judgeDecision?: string;
  result?: string;
};

export const emptyTaskMemory: TaskMemory = {
  preferredTestCommands: [],
  commonConstraints: []
};

export async function appendLearnedTaskMemory(cwd: string, state: AgentGraphState): Promise<void> {
  const record: LearnedTaskMemory = {
    createdAt: new Date().toISOString(),
    goalFingerprint: fingerprintGoal(state.goal),
    taskType: state.plan?.taskType ?? "unknown",
    riskLevel: state.plan?.riskLevel ?? "unknown",
    routingMode: state.routing.mode,
    accessMode: state.access.mode,
    visualPageType: state.visualSpec?.pageType,
    capabilitySummary: state.capabilityRoute?.summary,
    constraints: state.plan?.constraints ?? [],
    verificationCommands: unique([...(state.plan?.verificationCommands ?? []), ...state.runResults.map((result) => result.command)]),
    routingAssignments: state.routing.assignments.map((assignment) => ({
      role: assignment.role,
      provider: assignment.provider,
      model: assignment.model
    })),
    providerOutcomes: collectProviderOutcomes(state),
    selectedCandidate: state.judge?.selectedCandidateId,
    judgeDecision: state.judge?.decision,
    result: state.finalSummary?.result
  };
  const dir = path.join(cwd, ".tomorrowedge");
  await mkdir(dir, { recursive: true });
  await appendFile(path.join(dir, "task-memory.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
}

export async function readLearnedTaskMemory(cwd: string, limit = 20): Promise<LearnedTaskMemory[]> {
  const filePath = path.join(cwd, ".tomorrowedge", "task-memory.jsonl");
  const content = await readFile(filePath, "utf8").catch(() => "");
  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LearnedTaskMemory)
    .slice(-limit)
    .reverse();
}

function fingerprintGoal(goal: string): string {
  const normalized = goal.toLowerCase().replace(/\s+/g, " ").trim();
  let hash = 0;
  for (const char of normalized) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function collectProviderOutcomes(state: AgentGraphState): LearnedProviderOutcome[] {
  const outcomes: LearnedProviderOutcome[] = [];
  for (const agent of state.agents) {
    if (agent.provider === "local_tool") continue;
    if (agent.status === "success" || agent.status === "failed") {
      outcomes.push({
        role: agent.role,
        provider: agent.provider,
        model: agent.model,
        status: agent.status === "success" ? "success" : "failure"
      });
    }
  }
  for (const note of state.modelNotes) {
    if (note.fallbackFrom && note.fallbackReason) {
      outcomes.push({
        role: note.role,
        provider: note.fallbackFrom.provider,
        model: note.fallbackFrom.model,
        status: "failure",
        errorCategory: classifyProviderError(note.fallbackReason)
      });
    }
    outcomes.push({
      role: note.role,
      provider: note.provider,
      model: note.model,
      status: note.error ? "failure" : "success",
      errorCategory: note.error ? classifyProviderError(note.error) : undefined
    });
  }
  for (const event of state.events) {
    if (event.type !== "model_call" || !event.role || !event.provider || !event.model) continue;
    if (event.status !== "success" && event.status !== "failure") continue;
    const error = isRecord(event) && typeof event.error === "string" ? event.error : undefined;
    const errorCategory = isRecord(event) && typeof event.errorCategory === "string"
      ? event.errorCategory as ProviderErrorCategory
      : error
        ? classifyProviderError(error)
        : undefined;
    outcomes.push({
      role: event.role,
      provider: event.provider,
      model: event.model,
      status: event.status,
      errorCategory
    });
  }
  return dedupeOutcomes(outcomes);
}

function dedupeOutcomes(outcomes: LearnedProviderOutcome[]): LearnedProviderOutcome[] {
  const seen = new Set<string>();
  return outcomes.filter((outcome) => {
    const key = [outcome.role, outcome.provider, outcome.model, outcome.status, outcome.errorCategory ?? ""].join("\0");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
