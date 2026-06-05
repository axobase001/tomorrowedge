import { runQualityCostTraceBenchmark, renderBenchmarkMarkdown } from "../../core/eval/qualityCostTraceBenchmark.js";

export type BenchmarkOptions = {
  format?: "json" | "markdown";
};

export async function benchmarkCommand(cwd: string, options: BenchmarkOptions = {}): Promise<void> {
  const format = options.format === "json" ? "json" : "markdown";
  const result = await runQualityCostTraceBenchmark(cwd, { format });
  if (format === "json") {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  process.stdout.write(`${renderBenchmarkMarkdown(result)}\nReport: ${result.reportPath}\n`);
}
