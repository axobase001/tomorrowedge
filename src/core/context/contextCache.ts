import type { Plan } from "../../schemas/plan.js";
import type { ContextSelection } from "./fileSelector.js";
import { indexRepository } from "./repoIndexer.js";

const maxEntries = 50;
const plannerCache = new Map<string, Plan>();
const explorerCache = new Map<string, ContextSelection>();

export function getCachedPlan(cwd: string, goal: string, context?: unknown): Plan | undefined {
  return clone(plannerCache.get(plannerKey(cwd, goal, context)));
}

export function rememberPlan(cwd: string, goal: string, plan: Plan, context?: unknown): void {
  setBounded(plannerCache, plannerKey(cwd, goal, context), clone(plan));
}

export async function getCachedContextSelection(cwd: string, plan: Plan): Promise<ContextSelection | undefined> {
  return clone(explorerCache.get(await explorerKey(cwd, plan)));
}

export async function rememberContextSelection(cwd: string, plan: Plan, selection: ContextSelection): Promise<void> {
  setBounded(explorerCache, await explorerKey(cwd, plan), clone(selection));
}

export function clearContextCaches(): void {
  plannerCache.clear();
  explorerCache.clear();
}

function plannerKey(cwd: string, goal: string, context?: unknown): string {
  return JSON.stringify({ cwd, goal: goal.trim().toLowerCase(), context: stableContext(context) });
}

function stableContext(context: unknown): unknown {
  if (!context || typeof context !== "object" || Array.isArray(context)) return context ?? {};
  return Object.fromEntries(Object.entries(context as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)));
}

async function explorerKey(cwd: string, plan: Plan): Promise<string> {
  const fingerprint = (await indexRepository(cwd))
    .map((file) => `${file.path}:${file.sizeBytes}:${Math.round(file.mtimeMs)}:${file.risk}`)
    .join("|");
  return JSON.stringify({ cwd, plan: stablePlanForExplorer(plan), fingerprint });
}

function stablePlanForExplorer(plan: Plan): unknown {
  return {
    goal: plan.goal,
    riskLevel: plan.riskLevel,
    taskType: plan.taskType,
    workflowKind: plan.workflowKind,
    requiresPatchWorkflow: plan.requiresPatchWorkflow,
    allowedPhases: plan.allowedPhases ?? [],
    acceptanceCriteria: plan.acceptanceCriteria ?? [],
    constraints: plan.constraints,
    expectedFiles: plan.expectedFiles ?? [],
    verificationCommands: plan.verificationCommands ?? [],
    debateRecommended: plan.debateRecommended,
    steps: plan.steps.map((step) => ({
      id: step.id,
      title: step.title,
      detail: step.detail
    }))
  };
}

function setBounded<T>(cache: Map<string, T>, key: string, value: T): void {
  if (cache.size >= maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

function clone<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value)) as T;
}
