import type { ScenarioProfile } from "../scenarios/scenarioTypes.js";
import type { ObjectiveTraceV1 } from "./objectiveTrace.js";

export type TraceUtilityScore = {
  traceId: string;
  score: number;
  matchedSignals: string[];
};

export function scoreTraceUtility(trace: ObjectiveTraceV1, goal: string, scenarioProfile?: ScenarioProfile): TraceUtilityScore {
  const goalTokens = tokenize(goal);
  const traceTokens = tokenize(trace.goal);
  const matchedSignals: string[] = [];
  let score = 0;
  for (const token of goalTokens) {
    if (traceTokens.has(token)) {
      score += 2;
      matchedSignals.push(`goal:${token}`);
    }
  }
  if (scenarioProfile && trace.scenarioProfile.scenarioType === scenarioProfile.scenarioType) {
    score += 10;
    matchedSignals.push(`scenario:${scenarioProfile.scenarioType}`);
  }
  if (scenarioProfile && trace.scenarioProfile.likelyWorkflowKind === scenarioProfile.likelyWorkflowKind) {
    score += 6;
    matchedSignals.push(`workflow:${scenarioProfile.likelyWorkflowKind}`);
  }
  if (trace.outcome.finalStatus === "success") score += 4;
  if (trace.outcome.finalStatus === "failure") score += 2;
  score -= stalePenalty(trace.createdAt);
  return { traceId: trace.traceId, score: Math.max(0, score), matchedSignals };
}

function stalePenalty(createdAt: string): number {
  const ageMs = Date.now() - Date.parse(createdAt);
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 0;
  const days = ageMs / (24 * 60 * 60 * 1000);
  return days > 90 ? 8 : days > 30 ? 4 : 0;
}

function tokenize(value: string): Set<string> {
  return new Set(value.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, " ").split(/\s+/).filter((item) => item.length >= 2));
}

