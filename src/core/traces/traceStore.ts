import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ScenarioProfile, ScenarioType } from "../scenarios/scenarioTypes.js";
import type { OrchestrationPolicyGenome } from "../orchestrationPolicy/orchestrationPolicy.js";
import type { ObjectiveTraceV1 } from "./objectiveTrace.js";
import { scoreTraceUtility } from "./traceScorer.js";
import { withFileLock } from "../persistence/fileLock.js";
import { log } from "../../utils/logger.js";

export type TraceRetrievalPolicy = Pick<OrchestrationPolicyGenome["tracePolicy"],
  "preferRecent" | "preferSuccessTraces" | "preferFailureTraces" | "avoidStaleTraces">;

export type TraceRetrievalDiagnostics = {
  selected: ObjectiveTraceV1[];
  rejected: Array<{ traceId: string; score: number; reason: "score_filtered" | "topk_overflow" }>;
  consideredCount: number;
};

export async function addTrace(cwd: string, trace: ObjectiveTraceV1): Promise<void> {
  await withFileLock(traceFile(cwd), async () => {
    const traces = await readTraces(cwd, { limit: 10_000, newestFirst: false });
    const next = [...traces.filter((item) => item.traceId !== trace.traceId), trace].slice(-1000);
    await writeTraceFile(cwd, next);
  });
}

export async function readTraces(cwd: string, options: { limit?: number; newestFirst?: boolean; scenarioType?: ScenarioType } = {}): Promise<ObjectiveTraceV1[]> {
  const filePath = traceFile(cwd);
  const content = await readFile(filePath, "utf8").catch(() => "");
  const traces = content
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line, index) => {
      try {
        const parsed = JSON.parse(line) as ObjectiveTraceV1;
        return parsed.schemaVersion === "objective-trace/v1" ? [parsed] : [];
      } catch (error) {
        log("warn", `Ignoring malformed objective trace line ${index + 1} in ${path.relative(cwd, filePath) || filePath}: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }
    })
    .filter((trace) => !options.scenarioType || trace.scenarioProfile.scenarioType === options.scenarioType);
  const selected = traces.slice(-(options.limit ?? 20));
  return options.newestFirst === false ? selected : selected.reverse();
}

export async function retrieveSimilar(
  cwd: string,
  goal: string,
  scenarioProfile: ScenarioProfile,
  topK = 3,
  tracePolicy?: TraceRetrievalPolicy
): Promise<ObjectiveTraceV1[]> {
  return (await retrieveSimilarWithDiagnostics(cwd, goal, scenarioProfile, topK, tracePolicy)).selected;
}

export async function retrieveSimilarWithDiagnostics(
  cwd: string,
  goal: string,
  scenarioProfile: ScenarioProfile,
  topK = 3,
  tracePolicy?: TraceRetrievalPolicy
): Promise<TraceRetrievalDiagnostics> {
  const traces = await readTraces(cwd, { limit: 200, newestFirst: true });
  const scored = traces
    .map((trace) => ({ trace, score: scoreTraceForRetrieval(trace, goal, scenarioProfile, tracePolicy) }))
    .sort((a, b) => b.score - a.score || b.trace.createdAt.localeCompare(a.trace.createdAt));
  const eligible = scored.filter((item) => item.score > 0);
  const selected = eligible.slice(0, topK);
  const selectedIds = new Set(selected.map((item) => item.trace.traceId));
  return {
    selected: selected.map((item) => item.trace),
    rejected: scored
      .filter((item) => !selectedIds.has(item.trace.traceId))
      .map((item) => ({
        traceId: item.trace.traceId,
        score: item.score,
        reason: item.score <= 0 ? "score_filtered" : "topk_overflow"
      })),
    consideredCount: scored.length
  };
}

export function scoreTraceForRetrieval(
  trace: ObjectiveTraceV1,
  goal: string,
  scenarioProfile: ScenarioProfile,
  tracePolicy?: TraceRetrievalPolicy
): number {
  let score = scoreTraceUtility(trace, goal, scenarioProfile).score;
  if (trace.scenarioProfile.scenarioType === scenarioProfile.scenarioType) score += 6;
  if (trace.scenarioProfile.likelyWorkflowKind === scenarioProfile.likelyWorkflowKind) score += 4;

  if (!tracePolicy) return score;

  if (tracePolicy.preferSuccessTraces && trace.outcome.finalStatus === "success") score += 8;
  if (tracePolicy.preferFailureTraces && (trace.outcome.finalStatus === "failure" || trace.outcome.finalStatus === "partial")) score += 8;
  if (tracePolicy.preferRecent) score += recentBoost(trace.createdAt);
  if (tracePolicy.avoidStaleTraces) score -= stalePenalty(trace.createdAt);
  return Math.max(0, score);
}

export async function sampleRecent(cwd: string, n = 5): Promise<ObjectiveTraceV1[]> {
  return readTraces(cwd, { limit: n, newestFirst: true });
}

export async function sampleSuccesses(cwd: string, n = 5): Promise<ObjectiveTraceV1[]> {
  return (await readTraces(cwd, { limit: 200, newestFirst: true })).filter((trace) => trace.outcome.finalStatus === "success").slice(0, n);
}

export async function sampleFailures(cwd: string, n = 5): Promise<ObjectiveTraceV1[]> {
  return (await readTraces(cwd, { limit: 200, newestFirst: true })).filter((trace) => trace.outcome.finalStatus === "failure" || trace.outcome.finalStatus === "partial").slice(0, n);
}

export async function sampleByScenario(cwd: string, scenarioType: ScenarioType, n = 5): Promise<ObjectiveTraceV1[]> {
  return readTraces(cwd, { limit: n, newestFirst: true, scenarioType });
}

async function writeTraceFile(cwd: string, traces: ObjectiveTraceV1[]): Promise<void> {
  await mkdir(path.join(cwd, ".tomorrowedge"), { recursive: true });
  await writeFile(traceFile(cwd), traces.map((trace) => JSON.stringify(trace)).join("\n") + "\n", "utf8");
}

function traceFile(cwd: string): string {
  return path.join(cwd, ".tomorrowedge", "objective-traces.jsonl");
}

function recentBoost(createdAt: string): number {
  const ageDays = ageInDays(createdAt);
  if (ageDays === undefined) return 0;
  if (ageDays <= 7) return 6;
  if (ageDays <= 30) return 3;
  return 0;
}

function stalePenalty(createdAt: string): number {
  const ageDays = ageInDays(createdAt);
  if (ageDays === undefined) return 0;
  if (ageDays > 180) return 16;
  if (ageDays > 90) return 10;
  if (ageDays > 30) return 5;
  return 0;
}

function ageInDays(createdAt: string): number | undefined {
  const parsed = Date.parse(createdAt);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, (Date.now() - parsed) / (24 * 60 * 60 * 1000));
}
