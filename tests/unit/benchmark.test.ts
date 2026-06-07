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

      expect(result.winner).toBe("tomorrowedge");
      expect(result.strategies).toHaveLength(3);
      expect(report).toContain("Quality-Cost-Trace Benchmark");
      expect(report).toContain("WARNING: This is a deterministic product demo");
      expect(report).toContain("no real provider calls are made");
      expect(report).toContain("not a live provider leaderboard claim");
      expect(report).toContain("TomorrowEdge heterogeneous cockpit");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
