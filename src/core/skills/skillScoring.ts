import type { ObjectiveTraceToolUsage, ObjectiveTraceV1 } from "../traces/objectiveTrace.js";

export type ToolSkillPerformanceScore = {
  id: string;
  invocations: number;
  successes: number;
  failures: number;
  blocked: number;
  successRate: number;
  averageDurationMs?: number;
  score: number;
};

export function scoreToolSkillPerformance(traces: ObjectiveTraceV1[]): ToolSkillPerformanceScore[] {
  const grouped = new Map<string, ObjectiveTraceToolUsage[]>();
  for (const usage of traces.flatMap((trace) => trace.toolUsage ?? [])) {
    const id = usage.skillId ?? usage.toolId;
    grouped.set(id, [...(grouped.get(id) ?? []), usage]);
  }
  return [...grouped.entries()].map(([id, usages]) => scoreGroup(id, usages)).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

function scoreGroup(id: string, usages: ObjectiveTraceToolUsage[]): ToolSkillPerformanceScore {
  const successes = usages.filter((usage) => usage.outcome === "success").length;
  const failures = usages.filter((usage) => usage.outcome === "failure").length;
  const blocked = usages.filter((usage) => usage.outcome === "blocked").length;
  const durations = usages.map((usage) => usage.durationMs).filter((duration): duration is number => typeof duration === "number");
  const successRate = usages.length ? successes / usages.length : 0;
  return {
    id,
    invocations: usages.length,
    successes,
    failures,
    blocked,
    successRate: Math.round(successRate * 100) / 100,
    averageDurationMs: durations.length ? Math.round(durations.reduce((sum, item) => sum + item, 0) / durations.length) : undefined,
    score: Math.round(successRate * 100 - failures * 8 - blocked * 12 + Math.min(20, usages.length))
  };
}
