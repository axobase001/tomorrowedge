import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultConfig } from "../../config/defaultConfig.js";
import { makeId } from "../../utils/ids.js";
import { runOfflineGraph, type OfflineGraphOptions } from "../agentGraph/executor.js";
import type { AgentGraphState } from "../agentGraph/state.js";

export type BenchmarkStrategy = {
  id: "strong-single" | "cheap-single" | "tomorrowedge";
  label: string;
  sessionId: string;
  result: string;
  testsPassed: number;
  testsFailed: number;
  hiddenTestsPassed: number | null;
  estimatedCostUsd: number | null;
  elapsedMs: number;
  repairRounds: number;
  strongAgentCalls: number | null;
  traceCompleteness: number | null;
  eventCount: number;
  artifactCount: number;
  notes: string[];
};

export type QualityCostTraceBenchmark = {
  id: string;
  createdAt: string;
  fixture: string;
  caveat: string;
  strategies: BenchmarkStrategy[];
  winner: string | null;
  reportPath: string;
};

export const benchmarkDemoWarning = "WARNING: This is an audited deterministic fixture comparison; no real provider calls or hidden-test leaderboard claims are made.";

export async function runQualityCostTraceBenchmark(cwd: string, options: { format?: "json" | "markdown" } = {}): Promise<QualityCostTraceBenchmark> {
  const id = makeId("benchmark");
  const createdAt = new Date().toISOString();
  const workspaceRoot = path.join(cwd, ".tomorrowedge", "benchmarks", id, "workspaces");
  const fixtureRoot = path.resolve(cwd, "tests", "fixtures", "sample-repo-basic");
  const strategies = await Promise.all([
    runStrategy(workspaceRoot, fixtureRoot, {
      id: "strong-single",
      label: "Single-pass fixture route",
      goal: "fix failing test",
      options: { provider: "fixture", fixtureMode: true, approvePatch: true, approveShell: true },
      notes: ["Single successful fixture run; cost and strong-agent calls are not measured without live providers."]
    }),
    runStrategy(workspaceRoot, fixtureRoot, {
      id: "cheap-single",
      label: "No-repair fixture route",
      goal: "fix failing test",
      options: { provider: "fixture", fixtureMode: true, approvePatch: true, approveShell: true, fixtureFailingPatch: true },
      notes: ["Uses a seeded failing candidate without repair to preserve a cheap/single-pass failure control."]
    }),
    runStrategy(workspaceRoot, fixtureRoot, {
      id: "tomorrowedge",
      label: "TomorrowEdge repair-loop fixture route",
      goal: "fix failing test",
      options: { provider: "fixture", fixtureMode: true, approvePatch: true, approveShell: true, approveRepair: true, repairOnFail: true, fixtureFailingPatch: true },
      notes: ["Uses the audited patch/test/repair loop and derives metrics from the recorded session state."]
    })
  ]);
  const result: QualityCostTraceBenchmark = {
    id,
    createdAt,
    fixture: "offline fixture workflow comparison",
    caveat: `${benchmarkDemoWarning} Synthetic cost, hidden-test, and winner fields were removed; unavailable measurements are reported as not measured.`,
    strategies,
    winner: null,
    reportPath: ""
  };
  const report = options.format === "json" ? JSON.stringify(result, null, 2) : renderBenchmarkMarkdown(result);
  const dir = path.join(cwd, ".tomorrowedge", "benchmarks");
  await mkdir(dir, { recursive: true });
  const reportPath = path.join(dir, `${id}.${options.format === "json" ? "json" : "md"}`);
  await writeFile(reportPath, report, "utf8");
  return { ...result, reportPath };
}

async function runStrategy(workspaceRoot: string, fixtureRoot: string, input: {
  id: BenchmarkStrategy["id"];
  label: string;
  goal: string;
  options: OfflineGraphOptions;
  notes: string[];
}): Promise<BenchmarkStrategy> {
  const workspace = path.join(workspaceRoot, input.id);
  await prepareFixtureWorkspace(workspaceRoot, workspace, fixtureRoot);
  const startedAt = Date.now();
  const state = await runOfflineGraph(workspace, input.goal, defaultConfig, input.options);
  const elapsedMs = Math.max(1, Date.now() - startedAt);
  return deriveStrategy(input, state, elapsedMs);
}

async function prepareFixtureWorkspace(workspaceRoot: string, workspace: string, fixtureRoot: string): Promise<void> {
  const fallbackFixtureRoot = path.resolve(process.cwd(), "tests", "fixtures", "sample-repo-basic");
  await mkdir(workspaceRoot, { recursive: true });
  await rm(workspace, { recursive: true, force: true });
  await cp(fixtureRoot, workspace, { recursive: true }).catch(async () => {
    await cp(fallbackFixtureRoot, workspace, { recursive: true });
  });
}

function deriveStrategy(input: {
  id: BenchmarkStrategy["id"];
  label: string;
  notes: string[];
}, state: AgentGraphState, elapsedMs: number): BenchmarkStrategy {
  const executedRuns = state.runResults.filter((run) => !run.skipped);
  return {
    id: input.id,
    label: input.label,
    sessionId: state.sessionId,
    result: state.finalSummary?.result ?? "unknown",
    testsPassed: executedRuns.filter((run) => run.success).length,
    testsFailed: executedRuns.filter((run) => !run.success).length,
    hiddenTestsPassed: null,
    estimatedCostUsd: state.usageSummary.estimatedCostUsd ?? null,
    elapsedMs,
    repairRounds: state.repairCandidates.length || state.events.filter((event) => event.type === "repair_attempt").length,
    strongAgentCalls: null,
    traceCompleteness: state.traceCompleteness?.score ?? null,
    eventCount: state.events.length,
    artifactCount: state.eventArtifacts.length,
    notes: [
      ...input.notes,
      `session=${state.sessionId}`,
      `result=${state.finalSummary?.result ?? "unknown"}`,
      "hidden tests, live provider cost, and strong-agent call counts are not measured in this no-key fixture comparison."
    ]
  };
}

export function renderBenchmarkMarkdown(result: QualityCostTraceBenchmark): string {
  return `# Quality-Cost-Trace Benchmark ${result.id}

> ${result.caveat}

Created: ${result.createdAt}

Fixture: ${result.fixture}

| Strategy | Result | Tests passed | Tests failed | Hidden | Cost | Time | Repairs | Strong Calls | Trace | Events |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${result.strategies.map((item) => `| ${item.label} | ${item.result} | ${item.testsPassed} | ${item.testsFailed} | ${formatNullableInt(item.hiddenTestsPassed)} | ${formatUsd(item.estimatedCostUsd)} | ${(item.elapsedMs / 1000).toFixed(1)}s | ${item.repairRounds} | ${formatNullableInt(item.strongAgentCalls)} | ${formatNullableInt(item.traceCompleteness)} | ${item.eventCount} |`).join("\n")}

Winner: ${result.winner ?? "not ranked; fixture comparison only"}

${result.strategies.map((item) => `## ${item.label}\n\n${item.notes.map((note) => `- ${note}`).join("\n")}`).join("\n\n")}
`;
}

function formatNullableInt(value: number | null): string {
  return value === null ? "not measured" : String(Math.round(value));
}

function formatUsd(value: number | null): string {
  return value === null ? "not measured" : `$${value.toFixed(6)}`;
}
