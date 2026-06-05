import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { makeId } from "../../utils/ids.js";

export type BenchmarkStrategy = {
  id: "strong-single" | "cheap-single" | "tomorrowedge";
  label: string;
  testsPassed: number;
  hiddenTestsPassed: number;
  estimatedCostUsd: number;
  elapsedMs: number;
  repairRounds: number;
  strongAgentCalls: number;
  traceCompleteness: number;
  notes: string[];
};

export type QualityCostTraceBenchmark = {
  id: string;
  createdAt: string;
  fixture: string;
  caveat: string;
  strategies: BenchmarkStrategy[];
  winner: string;
  reportPath: string;
};

export async function runQualityCostTraceBenchmark(cwd: string, options: { format?: "json" | "markdown" } = {}): Promise<QualityCostTraceBenchmark> {
  const id = makeId("benchmark");
  const createdAt = new Date().toISOString();
  const strategies: BenchmarkStrategy[] = [
    {
      id: "strong-single",
      label: "Strong single agent",
      testsPassed: 1,
      hiddenTestsPassed: 1,
      estimatedCostUsd: 0.48,
      elapsedMs: 42_000,
      repairRounds: 0,
      strongAgentCalls: 4,
      traceCompleteness: 58,
      notes: ["High judgment quality, but expensive and less role-auditable."]
    },
    {
      id: "cheap-single",
      label: "Cheap single model",
      testsPassed: 1,
      hiddenTestsPassed: 0,
      estimatedCostUsd: 0.03,
      elapsedMs: 18_000,
      repairRounds: 1,
      strongAgentCalls: 0,
      traceCompleteness: 42,
      notes: ["Low cost, but weaker review and less reliable hidden-test behavior."]
    },
    {
      id: "tomorrowedge",
      label: "TomorrowEdge heterogeneous cockpit",
      testsPassed: 1,
      hiddenTestsPassed: 1,
      estimatedCostUsd: 0.16,
      elapsedMs: 31_000,
      repairRounds: 1,
      strongAgentCalls: 2,
      traceCompleteness: 94,
      notes: ["Strong roles are rationed for plan/review/judge; execution and repair remain visible."]
    }
  ];
  const result: QualityCostTraceBenchmark = {
    id,
    createdAt,
    fixture: "offline quality-cost-trace demo",
    caveat: "Deterministic no-key product demo. It is not a live provider leaderboard claim.",
    strategies,
    winner: "tomorrowedge",
    reportPath: ""
  };
  const report = options.format === "json" ? JSON.stringify(result, null, 2) : renderBenchmarkMarkdown(result);
  const dir = path.join(cwd, ".tomorrowedge", "benchmarks");
  await mkdir(dir, { recursive: true });
  const reportPath = path.join(dir, `${id}.${options.format === "json" ? "json" : "md"}`);
  await writeFile(reportPath, report, "utf8");
  return { ...result, reportPath };
}

export function renderBenchmarkMarkdown(result: QualityCostTraceBenchmark): string {
  return `# Quality-Cost-Trace Benchmark ${result.id}

Created: ${result.createdAt}

Fixture: ${result.fixture}

${result.caveat}

| Strategy | Tests | Hidden | Cost | Time | Repairs | Strong Calls | Trace |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${result.strategies.map((item) => `| ${item.label} | ${item.testsPassed} | ${item.hiddenTestsPassed} | $${item.estimatedCostUsd.toFixed(2)} | ${(item.elapsedMs / 1000).toFixed(1)}s | ${item.repairRounds} | ${item.strongAgentCalls} | ${item.traceCompleteness} |`).join("\n")}

Winner: ${result.winner}

${result.strategies.map((item) => `## ${item.label}\n\n${item.notes.map((note) => `- ${note}`).join("\n")}`).join("\n\n")}
`;
}
