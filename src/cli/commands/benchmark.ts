import { runBenchmarkDemo, renderBenchmarkReport } from "../../core/eval/benchmarkDemo.js";

export type BenchmarkOptions = {
  task?: string;
  fixture?: string;
  output?: "json" | "markdown";
};

export async function benchmarkCommand(cwd: string, options: BenchmarkOptions = {}): Promise<void> {
  const result = await runBenchmarkDemo(cwd, {
    task: options.task,
    fixture: options.fixture
  });
  if (options.output === "json") {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  process.stdout.write(`${renderBenchmarkReport(result)}\n\nreport: ${result.reportPath}\n`);
}
