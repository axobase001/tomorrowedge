import { describe, expect, it } from "vitest";
import { runBenchmarkDemo, renderBenchmarkReport } from "../../src/core/eval/benchmarkDemo.js";

describe("benchmark demo", () => {
  it("compares strong, cheap, and TomorrowEdge multi-role workflows", async () => {
    const result = await runBenchmarkDemo(process.cwd());
    const report = renderBenchmarkReport(result);

    expect(result.cases.map((item) => item.id)).toEqual(["strong_single", "cheap_single", "tomorrowedge_multi_role"]);
    expect(result.cases.find((item) => item.id === "tomorrowedge_multi_role")?.repairAttempts).toBeGreaterThan(0);
    expect(result.cases.find((item) => item.id === "tomorrowedge_multi_role")?.traceCompleteness).toBeGreaterThan(0);
    expect(report).toContain("TomorrowEdge Benchmark Demo");
    expect(report).toContain("Quality");
  }, 20_000);
});
