import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultConfig } from "../../config/defaultConfig.js";
import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import { makeId } from "../../utils/ids.js";
import { runOfflineGraph } from "../agentGraph/executor.js";
import type { AgentGraphState } from "../agentGraph/state.js";
import { estimateCostUsd } from "../model/costAccounting.js";

export type BenchmarkDemoOptions = {
  task?: string;
  fixture?: string;
};

export type BenchmarkDemoResult = {
  id: string;
  createdAt: string;
  task: string;
  fixture: string;
  note: string;
  cases: BenchmarkCaseResult[];
  reportPath: string;
};

export type BenchmarkCaseResult = {
  id: "strong_single" | "cheap_single" | "tomorrowedge_multi_role";
  label: string;
  modelStrategy: string;
  qualityScore: number;
  estimatedCostUsd: number;
  elapsedMs: number;
  traceCompleteness: number;
  repairAttempts: number;
  repairVisibility: "none" | "recorded";
  finalResult: string;
  latestTestSuccess?: boolean;
  fixtureWorkspace: string;
  routeSummary: string[];
};

const benchmarkRoles: AgentRole[] = ["planner", "explorer", "coder_a", "coder_b", "reviewer", "judge", "repairer", "summarizer"];

export async function runBenchmarkDemo(cwd: string, options: BenchmarkDemoOptions = {}): Promise<BenchmarkDemoResult> {
  const id = makeId("benchmark");
  const task = options.task ?? "fix the failing package test and explain the repair";
  const fixture = options.fixture ?? "sample-repo-basic";
  const createdAt = new Date().toISOString();
  const cases: BenchmarkCaseResult[] = [];

  cases.push(await runBenchmarkCase(cwd, fixture, task, {
    id: "strong_single",
    label: "Strong single model",
    modelStrategy: "One high-capability provider owns planning, coding, review, judge, and summary.",
    config: singleProviderConfig("openrouter", "openai/gpt-5.2", "quality"),
    fixtureFailingPatch: false,
    repairOnFail: false
  }));
  cases.push(await runBenchmarkCase(cwd, fixture, task, {
    id: "cheap_single",
    label: "Cheap single model",
    modelStrategy: "One low-cost coding provider owns the whole workflow; no repair loop.",
    config: singleProviderConfig("deepseek", "deepseek-chat", "cheap"),
    fixtureFailingPatch: true,
    repairOnFail: false
  }));
  cases.push(await runBenchmarkCase(cwd, fixture, task, {
    id: "tomorrowedge_multi_role",
    label: "TomorrowEdge multi-role workflow",
    modelStrategy: "Planner/reviewer/judge use stronger routing; coder/repairer use cheaper execution lanes with full trace.",
    config: multiRoleConfig(),
    fixtureFailingPatch: true,
    repairOnFail: true
  }));

  const result: BenchmarkDemoResult = {
    id,
    createdAt,
    task,
    fixture,
    note: "Deterministic no-key benchmark demo. Cost is estimated from routed provider defaults; this is not a live provider leaderboard.",
    cases,
    reportPath: ""
  };
  const reportPath = await saveBenchmarkReport(cwd, id, renderBenchmarkReport({ ...result, reportPath: "" }));
  return { ...result, reportPath };
}

export function renderBenchmarkReport(result: BenchmarkDemoResult): string {
  return [
    "# TomorrowEdge Benchmark Demo",
    "",
    `ID: ${result.id}`,
    `Created: ${result.createdAt}`,
    `Task: ${result.task}`,
    `Fixture: ${result.fixture}`,
    "",
    result.note,
    "",
    "| Strategy | Quality | Cost USD | Time ms | Trace | Repairs | Result |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...result.cases.map((item) =>
      `| ${item.label} | ${item.qualityScore} | ${item.estimatedCostUsd.toFixed(6)} | ${item.elapsedMs} | ${item.traceCompleteness} | ${item.repairAttempts} | ${item.finalResult} |`
    ),
    "",
    "## Route Summary",
    "",
    ...result.cases.flatMap((item) => [
      `### ${item.label}`,
      item.modelStrategy,
      "",
      ...item.routeSummary.map((route) => `- ${route}`),
      ""
    ])
  ].join("\n");
}

async function runBenchmarkCase(
  cwd: string,
  fixture: string,
  task: string,
  input: {
    id: BenchmarkCaseResult["id"];
    label: string;
    modelStrategy: string;
    config: TomorrowEdgeConfig;
    fixtureFailingPatch: boolean;
    repairOnFail: boolean;
  }
): Promise<BenchmarkCaseResult> {
  const fixtureWorkspace = await prepareFixtureWorkspace(cwd, fixture);
  const started = Date.now();
  const state = await runOfflineGraph(fixtureWorkspace, task, input.config, {
    accessMode: "full",
    fixtureMode: true,
    fixtureFailingPatch: input.fixtureFailingPatch,
    repairOnFail: input.repairOnFail
  });
  const elapsedMs = Date.now() - started;
  const latestRun = state.runResults.at(-1);
  return {
    id: input.id,
    label: input.label,
    modelStrategy: input.modelStrategy,
    qualityScore: scoreQuality(state),
    estimatedCostUsd: estimateWorkflowCost(state),
    elapsedMs,
    traceCompleteness: state.traceCompleteness?.score ?? 0,
    repairAttempts: state.repairCandidates.length,
    repairVisibility: state.repairCandidates.length ? "recorded" : "none",
    finalResult: state.finalSummary?.result ?? "unknown",
    latestTestSuccess: latestRun?.success,
    fixtureWorkspace,
    routeSummary: state.routing.assignments
      .filter((assignment) => ["planner", "coder_a", "reviewer", "judge", "repairer", "runner"].includes(assignment.role))
      .map((assignment) => `${assignment.role}: ${assignment.provider}/${assignment.model}`)
  };
}

async function prepareFixtureWorkspace(cwd: string, fixture: string): Promise<string> {
  const source = path.join(cwd, "tests", "fixtures", fixture);
  const workspace = await mkdtemp(path.join(os.tmpdir(), "tedge-benchmark-demo-"));
  await cp(source, workspace, { recursive: true });
  return workspace;
}

function singleProviderConfig(provider: string, model: string, mode: "cheap" | "quality"): TomorrowEdgeConfig {
  return {
    ...multiRoleConfig(),
    routing: { ...defaultConfig.routing, mode },
    debate: { ...defaultConfig.debate, max_candidates: 1 },
    agents: benchmarkRoles.reduce((agents, role) => ({
      ...agents,
      [role]: { provider, model }
    }), { ...defaultConfig.agents })
  };
}

function multiRoleConfig(): TomorrowEdgeConfig {
  return {
    ...defaultConfig,
    providers: {
      ...defaultConfig.providers,
      openrouter: { ...defaultConfig.providers.openrouter, enabled: true, model: "openai/gpt-5.2" },
      deepseek: { ...defaultConfig.providers.deepseek, enabled: true, base_url: "https://api.deepseek.com", model: "deepseek-chat" }
    },
    debate: { ...defaultConfig.debate, max_candidates: 2 }
  };
}

function scoreQuality(state: AgentGraphState): number {
  const latestRun = state.runResults.at(-1);
  let score = 20;
  if (state.judge?.decision === "select") score += 20;
  if (state.changedFiles.includes("index.js")) score += 15;
  if (latestRun?.success) score += 30;
  if (state.traceCompleteness) score += Math.min(15, Math.round(state.traceCompleteness.score / 7));
  if (latestRun?.success && state.repairCandidates.length) score += 10;
  return Math.min(100, score);
}

function estimateWorkflowCost(state: AgentGraphState): number {
  const cost = state.agents.reduce((sum, agent) => {
    if (agent.provider === "local_tool") return sum;
    const estimate = estimateCostUsd(agent.provider, { inputTokens: 1400, outputTokens: 700 }) ?? 0;
    return sum + estimate;
  }, 0);
  return Math.round(cost * 1_000_000) / 1_000_000;
}

async function saveBenchmarkReport(cwd: string, id: string, report: string): Promise<string> {
  const dir = path.join(cwd, ".tomorrowedge", "benchmarks");
  await mkdir(dir, { recursive: true });
  const reportPath = path.join(dir, `${id}.md`);
  await writeFile(reportPath, report, "utf8");
  return reportPath;
}
