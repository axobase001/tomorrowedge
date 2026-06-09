import type { Plan } from "../../schemas/plan.js";
import type { ContextSelection } from "./fileSelector.js";
import { indexRepository } from "./repoIndexer.js";

const maxEntries = 50;
const plannerCache = new Map<string, Plan>();
const explorerCache = new Map<string, ContextSelection>();

export function getCachedPlan(cwd: string, goal: string): Plan | undefined {
  return clone(plannerCache.get(plannerKey(cwd, goal)));
}

export function rememberPlan(cwd: string, goal: string, plan: Plan): void {
  setBounded(plannerCache, plannerKey(cwd, goal), clone(plan));
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

function plannerKey(cwd: string, goal: string): string {
  return JSON.stringify({ cwd, goal: goal.trim().toLowerCase() });
}

async function explorerKey(cwd: string, plan: Plan): Promise<string> {
  const fingerprint = (await indexRepository(cwd))
    .map((file) => `${file.path}:${file.sizeBytes}:${Math.round(file.mtimeMs)}:${file.risk}`)
    .join("|");
  return JSON.stringify({ cwd, plan, fingerprint });
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
