import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runQualityCostTraceBenchmark } from "../../src/core/eval/qualityCostTraceBenchmark.js";

describe("quality-cost-trace benchmark", () => {
  it("writes a deterministic offline benchmark report", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-benchmark-"));
    try {
      const result = await runQualityCostTraceBenchmark(cwd, { format: "markdown" });
      const report = await readFile(result.reportPath, "utf8");

      expect(result.winner).toBeNull();
      expect(result.strategies).toHaveLength(3);
      expect(result.strategies.every((strategy) => strategy.sessionId.startsWith("session_"))).toBe(true);
      expect(result.strategies.every((strategy) => strategy.eventCount > 0)).toBe(true);
      expect(result.strategies.find((strategy) => strategy.id === "cheap-single")?.testsFailed).toBeGreaterThan(0);
      expect(result.strategies.find((strategy) => strategy.id === "tomorrowedge")?.repairRounds).toBeGreaterThan(0);
      expect(report).toContain("Quality-Cost-Trace Benchmark");
      expect(report).toContain("WARNING: This is an audited deterministic fixture comparison");
      expect(report).toContain("no real provider calls");
      expect(report).toContain("hidden-test leaderboard claims");
      expect(report).toContain("not measured");
      expect(report).toContain("Winner: not ranked");
      expect(report).toContain("TomorrowEdge repair-loop fixture route");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
