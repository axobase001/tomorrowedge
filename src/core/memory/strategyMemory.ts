import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import { parseGoalToPlan } from "../goal/goalParser.js";
import type { AgentRouteOverrides } from "../routing/policies.js";
import { readLearnedTaskMemory, type LearnedProviderOutcome, type LearnedTaskMemory } from "./taskMemory.js";

export type StrategyMemoryRoute = {
  role: AgentRole;
  provider: string;
  model: string;
  reason: string;
  successes: number;
  failures: number;
};

export type StrategyMemoryAvoidance = {
  role: AgentRole;
  provider: string;
  model: string;
  errorCategory: string;
};

export type StrategyMemoryRoutingSummary = {
  enabled: boolean;
  taskType: string;
  recordsConsidered: number;
  routeOverrides: AgentRouteOverrides;
  routes: StrategyMemoryRoute[];
  avoid: StrategyMemoryAvoidance[];
  preferredTestCommands: string[];
  reasons: string[];
};

type RouteScore = {
  role: AgentRole;
  provider: string;
  model: string;
  successes: number;
  failures: number;
  score: number;
};

const blockedFailureCategories = new Set(["rate_limited", "quota_exhausted", "invalid_key", "invalid_model"]);

export async function buildStrategyMemoryRouting(cwd: string, goal: string, config: TomorrowEdgeConfig): Promise<StrategyMemoryRoutingSummary> {
  const taskType = parseGoalToPlan(goal).taskType;
  const records = (await readLearnedTaskMemory(cwd, config.memory.history_limit))
    .filter((record) => record.taskType === taskType || taskType === "unknown")
    .filter((record) => Boolean(record.providerOutcomes?.length || record.verificationCommands.length));
  const scores = new Map<string, RouteScore>();
  const avoid = collectAvoidance(records);
  const avoidKeys = new Set(avoid.map((item) => routeKey(item.role, item.provider, item.model)));

  for (const outcome of records.flatMap((record) => record.providerOutcomes ?? [])) {
    if (!isRoutableOutcome(config, outcome)) continue;
    const key = routeKey(outcome.role, outcome.provider, outcome.model);
    const existing = scores.get(key) ?? {
      role: outcome.role,
      provider: outcome.provider,
      model: outcome.model,
      successes: 0,
      failures: 0,
      score: 0
    };
    if (outcome.status === "success") {
      existing.successes += 1;
      existing.score += 2;
    } else {
      existing.failures += 1;
      existing.score -= blockedFailureCategories.has(outcome.errorCategory ?? "") ? 5 : 2;
    }
    scores.set(key, existing);
  }

  const routes = bestRoutes(scores, avoidKeys).map((route) => ({
    ...route,
    reason: `strategy memory: ${route.successes} success, ${route.failures} failure for ${taskType} tasks`
  }));
  const routeOverrides: AgentRouteOverrides = {};
  for (const route of routes) {
    routeOverrides[route.role] = {
      provider: route.provider,
      model: route.model,
      reason: route.reason
    };
  }
  const preferredTestCommands = topCommands(records);
  const reasons = [
    records.length ? `considered ${records.length} ${taskType} memory record(s)` : `no ${taskType} memory records available`,
    ...routes.map((route) => `${route.role}: prefer ${route.provider}/${route.model}`),
    ...avoid.map((item) => `${item.role}: avoid ${item.provider}/${item.model} after ${item.errorCategory}`),
    preferredTestCommands[0] ? `preferred test command: ${preferredTestCommands[0]}` : undefined
  ].filter((value): value is string => Boolean(value));

  return {
    enabled: config.memory.strategy_routing,
    taskType,
    recordsConsidered: records.length,
    routeOverrides,
    routes,
    avoid,
    preferredTestCommands,
    reasons
  };
}

function collectAvoidance(records: LearnedTaskMemory[]): StrategyMemoryAvoidance[] {
  const seen = new Set<string>();
  const avoid: StrategyMemoryAvoidance[] = [];
  for (const outcome of records.slice(0, 10).flatMap((record) => record.providerOutcomes ?? [])) {
    if (outcome.status !== "failure") continue;
    if (!blockedFailureCategories.has(outcome.errorCategory ?? "")) continue;
    const key = routeKey(outcome.role, outcome.provider, outcome.model);
    if (seen.has(key)) continue;
    seen.add(key);
    avoid.push({
      role: outcome.role,
      provider: outcome.provider,
      model: outcome.model,
      errorCategory: outcome.errorCategory ?? "unknown"
    });
  }
  return avoid;
}

function bestRoutes(scores: Map<string, RouteScore>, avoidKeys: Set<string>): RouteScore[] {
  const byRole = new Map<AgentRole, RouteScore>();
  for (const score of scores.values()) {
    if (avoidKeys.has(routeKey(score.role, score.provider, score.model))) continue;
    if (score.successes <= score.failures || score.score <= 0) continue;
    const current = byRole.get(score.role);
    if (!current || score.score > current.score || (score.score === current.score && score.successes > current.successes)) {
      byRole.set(score.role, score);
    }
  }
  return [...byRole.values()];
}

function topCommands(records: LearnedTaskMemory[]): string[] {
  const counts = new Map<string, number>();
  for (const command of records.flatMap((record) => record.verificationCommands)) {
    const normalized = command.trim();
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([command]) => command);
}

function isRoutableOutcome(config: TomorrowEdgeConfig, outcome: LearnedProviderOutcome): boolean {
  if (outcome.provider === "local_tool" || outcome.role === "runner") return false;
  if (outcome.provider.startsWith("external:")) {
    const id = outcome.provider.slice("external:".length);
    return Boolean(config.external_agents[id]?.enabled);
  }
  if (["mock", "fixture"].includes(outcome.provider)) return true;
  return Boolean(config.providers[outcome.provider]?.enabled);
}

function routeKey(role: AgentRole, provider: string, model: string): string {
  return [role, provider, model].join("\0");
}
