import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ScenarioProfile, ScenarioType } from "../scenarios/scenarioTypes.js";
import type { ObjectiveTraceV1 } from "./objectiveTrace.js";
import { scoreTraceUtility } from "./traceScorer.js";

export async function addTrace(cwd: string, trace: ObjectiveTraceV1): Promise<void> {
  const traces = await readTraces(cwd, { limit: 10_000, newestFirst: false });
  const next = [...traces.filter((item) => item.traceId !== trace.traceId), trace].slice(-1000);
  await writeTraceFile(cwd, next);
}

export async function readTraces(cwd: string, options: { limit?: number; newestFirst?: boolean; scenarioType?: ScenarioType } = {}): Promise<ObjectiveTraceV1[]> {
  const content = await readFile(traceFile(cwd), "utf8").catch(() => "");
  const traces = content
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as ObjectiveTraceV1;
        return parsed.schemaVersion === "objective-trace/v1" ? [parsed] : [];
      } catch {
        return [];
      }
    })
    .filter((trace) => !options.scenarioType || trace.scenarioProfile.scenarioType === options.scenarioType);
  const selected = traces.slice(-(options.limit ?? 20));
  return options.newestFirst === false ? selected : selected.reverse();
}

export async function retrieveSimilar(cwd: string, goal: string, scenarioProfile: ScenarioProfile, topK = 3): Promise<ObjectiveTraceV1[]> {
  const traces = await readTraces(cwd, { limit: 200, newestFirst: true });
  return traces
    .map((trace) => ({ trace, score: scoreTraceUtility(trace, goal, scenarioProfile).score }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.trace.createdAt.localeCompare(a.trace.createdAt))
    .slice(0, topK)
    .map((item) => item.trace);
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

