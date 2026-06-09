import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runErrorLoopExperiment } from "../../src/core/eval/errorLoopExperiment.js";

describe("error-loop experiment export", () => {
  it("writes a deterministic reproducibility bundle with memory update status", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-error-loop-export-"));
    try {
      const result = await runErrorLoopExperiment(cwd, {
        tasks: ["fix failing test"],
        ablations: ["memory_on", "memory_off"],
        repetitions: 1,
        outputDir: "bundle"
      });
      const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as { schemaVersion: string; memoryPolicy: string; files: Record<string, string> };
      const metrics = JSON.parse(await readFile(result.metricsPath, "utf8")) as typeof result.metrics;
      const trialRows = (await readFile(result.trialsPath, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line) as { memoryUpdateStatus: string; schemaVersion: string; predictionTotal: number; memoryPolicyExploit: number; memoryPolicyBypass: number; recoveryAttemptsAfterFirstFailure: number; validationPassed: boolean; validationFailed: boolean; transferTaskPassed: boolean | null });
      const memoryRows = (await readFile(result.memoryRecordsPath, "utf8")).trim().split(/\r?\n/).filter(Boolean);
      const retrievalRows = (await readFile(result.retrievalDecisionsPath, "utf8")).trim().split(/\r?\n/).filter(Boolean);
      const report = await readFile(result.reportPath, "utf8");

      expect(manifest.schemaVersion).toBe("error-loop-manifest/v1");
      expect(manifest.memoryPolicy).toBe("balanced");
      expect(manifest.files.metrics).toBe("metrics.json");
      expect(metrics.trials).toBe(2);
      expect(metrics.memoryWritten).toBe(1);
      expect(metrics.memoryOccurrences).toBe(1);
      expect(metrics.memorySkipped.skipped_ablation).toBe(1);
      expect(metrics.memoryPolicyExploit + metrics.memoryPolicyBypass).toBeGreaterThan(0);
      expect(metrics).toHaveProperty("recoveryAttemptsAfterFirstFailureTotal");
      expect(metrics).toHaveProperty("averageRecoveryAttemptsAfterFirstFailure");
      expect(metrics).toHaveProperty("repeatedSameClassErrorRate");
      expect(metrics).toHaveProperty("validationPassRate");
      expect(metrics).toHaveProperty("transferTaskPassRate");
      expect(metrics).toHaveProperty("averageCostToRecoveryUsd");
      expect(metrics).toHaveProperty("averageTimeToRecoveryMs");
      expect(metrics).toHaveProperty("memoryRetrievalPrecision");
      expect(metrics).toHaveProperty("harmfulRetrievalRate");
      expect(metrics).toHaveProperty("repairSuccessAfterRetrievalRate");
      expect(metrics).toHaveProperty("predictionAccuracy");
      expect(metrics.suspectedNegativeTransfer).toBeGreaterThanOrEqual(0);
      expect(trialRows.map((row) => row.schemaVersion)).toEqual(["error-loop-trial/v1", "error-loop-trial/v1"]);
      expect(trialRows.map((row) => row.memoryUpdateStatus)).toContain("written");
      expect(trialRows.map((row) => row.memoryUpdateStatus)).toContain("skipped_ablation");
      expect(trialRows.every((row) => typeof row.predictionTotal === "number")).toBe(true);
      expect(trialRows.every((row) => typeof row.memoryPolicyExploit === "number")).toBe(true);
      expect(trialRows.every((row) => typeof row.memoryPolicyBypass === "number")).toBe(true);
      expect(trialRows.every((row) => typeof row.recoveryAttemptsAfterFirstFailure === "number")).toBe(true);
      expect(trialRows.every((row) => typeof row.validationPassed === "boolean")).toBe(true);
      expect(trialRows.every((row) => typeof row.validationFailed === "boolean")).toBe(true);
      expect(trialRows.every((row) => row.transferTaskPassed === null || typeof row.transferTaskPassed === "boolean")).toBe(true);
      expect(memoryRows.length).toBe(1);
      expect(retrievalRows.length).toBe(2);
      expect(report).toContain("Memory Update Status");
      expect(report).toContain("Memory policy");
      expect(report).toContain("Policy exploit/bypass");
      expect(report).toContain("Primary Hypothesis Metrics");
      expect(report).toContain("Secondary Hypothesis Metrics");
      expect(report).toContain("Prediction accuracy");
      expect(report).toContain("Suspected negative transfer");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
