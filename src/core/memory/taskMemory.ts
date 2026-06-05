import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentGraphState } from "../agentGraph/state.js";
import type { AgentRole } from "../../schemas/agentTask.js";

export type TaskMemory = {
  preferredTestCommands: string[];
  commonConstraints: string[];
  routingPreference?: string;
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
  selectedCandidate?: string;
  judgeDecision?: string;
  result?: string;
  routeAssignments?: Array<{ role: AgentRole; provider: string; model: string }>;
};

export type StrategyMemoryHints = {
  routeAssignments: Array<{ role: AgentRole; provider: string; model: string; reason: string }>;
  preferredTestCommand?: string;
  sourceRecords: number;
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
    verificationCommands: state.plan?.verificationCommands ?? [],
    selectedCandidate: state.judge?.selectedCandidateId,
    judgeDecision: state.judge?.decision,
    result: state.finalSummary?.result,
    routeAssignments: state.finalSummary?.result === "completed"
      ? state.routing.assignments
          .filter((assignment) => !["runner", "vision"].includes(assignment.role))
          .map((assignment) => ({ role: assignment.role, provider: assignment.provider, model: assignment.model }))
      : []
  };
  const dir = path.join(cwd, ".tomorrowedge");
  await mkdir(dir, { recursive: true });
  await appendFile(path.join(dir, "task-memory.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
}

export async function buildStrategyMemoryHints(cwd: string, options: { limit?: number } = {}): Promise<StrategyMemoryHints> {
  const records = await readLearnedTaskMemory(cwd, options.limit ?? 20);
  const successful = records.filter((record) => record.result === "completed");
  const routeByRole = new Map<AgentRole, { role: AgentRole; provider: string; model: string; reason: string }>();
  for (const record of successful) {
    for (const route of record.routeAssignments ?? []) {
      if (!routeByRole.has(route.role)) {
        routeByRole.set(route.role, {
          ...route,
          reason: `strategy memory: reused ${route.provider}/${route.model} from recent completed ${record.taskType} workflow`
        });
      }
    }
  }
  const preferredTestCommand = mostCommon(successful.flatMap((record) => record.verificationCommands ?? []));
  return {
    routeAssignments: [...routeByRole.values()],
    preferredTestCommand,
    sourceRecords: successful.length
  };
}

function mostCommon(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
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
