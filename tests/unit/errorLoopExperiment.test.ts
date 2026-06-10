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
        tasks: ["js-off-by-one-train"],
        ablations: ["memory_on", "memory_off"],
        repetitions: 1,
        outputDir: "bundle"
      });
      const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as { schemaVersion: string; memoryPolicy: string; files: Record<string, string>; runtime: { commitSha: string; fixtureCatalogHash: string }; tasks: Array<{ id: string; split: string; hiddenValidatorCount: number }> };
      const metrics = JSON.parse(await readFile(result.metricsPath, "utf8")) as typeof result.metrics;
      const trialRows = (await readFile(result.trialsPath, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line) as { memoryUpdateStatus: string; schemaVersion: string; predictionTotal: number; memoryPolicyExploit: number; memoryPolicyBypass: number; recoveryAttemptsAfterFirstFailure: number; validationPassed: boolean; validationFailed: boolean; transferTaskPassed: boolean | null; taskId: string; taskFamily: string; taskSplit: string; latentFailureType: string; language: string; validatorUncertain: boolean });
      const memoryRows = (await readFile(result.memoryRecordsPath, "utf8")).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as { schemaVersion: string; model_visible: unknown; evaluator_only: { fixtureId: string; leakageTokensChecked: number } });
      const retrievalRows = (await readFile(result.retrievalDecisionsPath, "utf8")).trim().split(/\r?\n/).filter(Boolean);
      const cohortRows = JSON.parse(await readFile(result.cohortMetricsPath, "utf8")) as typeof result.metrics.cohortMetrics;
      const report = await readFile(result.reportPath, "utf8");

      expect(manifest.schemaVersion).toBe("error-loop-manifest/v1");
      expect(manifest.memoryPolicy).toBe("balanced");
      expect(manifest.files.metrics).toBe("metrics.json");
      expect(manifest.files.cohortMetrics).toBe("cohort_metrics.json");
      expect(manifest.runtime.commitSha).toBeTruthy();
      expect(manifest.runtime.fixtureCatalogHash).toMatch(/^[0-9a-f]{64}$/);
      expect(manifest.tasks[0]).toMatchObject({ split: "train" });
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
      expect(metrics.leakage).toMatchObject({ checked: true, violations: 0 });
      expect(metrics.leakage.tokensChecked).toBeGreaterThan(0);
      expect(metrics.cohortMetrics.length).toBeGreaterThan(0);
      expect(cohortRows.length).toBe(metrics.cohortMetrics.length);
      expect(metrics.suspectedNegativeTransfer).toBeGreaterThanOrEqual(0);
      expect(trialRows.map((row) => row.schemaVersion)).toEqual(["error-loop-trial/v1", "error-loop-trial/v1"]);
      expect(trialRows.every((row) => row.taskId && row.taskFamily && row.taskSplit && row.latentFailureType && row.language)).toBe(true);
      expect(trialRows.every((row) => typeof row.validatorUncertain === "boolean")).toBe(true);
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
      expect(memoryRows[0]?.schemaVersion).toBe("error-loop-memory-export/v1");
      expect(memoryRows[0]?.model_visible).toBeTruthy();
      expect(memoryRows[0]?.evaluator_only.fixtureId).toBeTruthy();
      expect(retrievalRows.length).toBe(2);
      expect(report).toContain("Memory Update Status");
      expect(report).toContain("Memory policy");
      expect(report).toContain("Policy exploit/bypass");
      expect(report).toContain("Primary Hypothesis Metrics");
      expect(report).toContain("Secondary Hypothesis Metrics");
      expect(report).toContain("Prediction accuracy");
      expect(report).toContain("Suspected negative transfer");
      expect(report).toContain("Leakage Guard");
      expect(report).toContain("Cohorts");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("supports explicit memory ablation matrix modes", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-error-loop-ablation-matrix-"));
    try {
      const ablations = ["memory_off", "write_only", "retrieve_only", "success_memory_only", "failure_memory_only", "random_memory_control"] as const;
      const result = await runErrorLoopExperiment(cwd, {
        tasks: ["fix failing test"],
        ablations: [...ablations],
        repetitions: 1,
        outputDir: "matrix"
      });
      const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as {
        ablations: string[];
        ablationSettings: Record<string, { strategyMemoryEnabled: boolean; failureMemoryWriteEnabled: boolean; injectFailureCorrections: boolean; memoryPolicyOverride?: string }>;
      };
      const retrievalRows = (await readFile(result.retrievalDecisionsPath, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line) as { ablation: string; memoryPolicy: string });

      expect(manifest.ablations).toEqual([...ablations]);
      expect(manifest.ablationSettings.memory_off).toMatchObject({ strategyMemoryEnabled: false, failureMemoryWriteEnabled: false });
      expect(manifest.ablationSettings.write_only).toMatchObject({ strategyMemoryEnabled: false, failureMemoryWriteEnabled: true });
      expect(manifest.ablationSettings.success_memory_only).toMatchObject({ strategyMemoryEnabled: true, failureMemoryWriteEnabled: false, injectFailureCorrections: false });
      expect(manifest.ablationSettings.failure_memory_only).toMatchObject({ strategyMemoryEnabled: true, failureMemoryWriteEnabled: true, injectFailureCorrections: true });
      expect(manifest.ablationSettings.random_memory_control?.memoryPolicyOverride).toBe("random_control");
      expect(result.trials.find((trial) => trial.ablation === "memory_off")?.memoryUpdateStatus).toBe("skipped_ablation");
      expect(result.trials.find((trial) => trial.ablation === "write_only")?.memoryUpdateStatus).not.toBe("skipped_ablation");
      expect(retrievalRows.find((row) => row.ablation === "random_memory_control")?.memoryPolicy).toBe("random_control");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("runs catalog fixture splits and reports transfer plus validator uncertainty metadata", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-error-loop-catalog-"));
    try {
      const result = await runErrorLoopExperiment(cwd, {
        tasks: ["python-off-by-one-transfer", "flaky-validator-validation"],
        ablations: ["memory_on"],
        repetitions: 1,
        outputDir: "catalog"
      });

      expect(result.trials.map((trial) => trial.taskSplit)).toEqual(["transfer", "validation"]);
      expect(result.trials[0]?.transferTask).toBe(true);
      expect(result.trials[0]?.transferTaskPassed).not.toBeNull();
      expect(result.trials[1]?.validatorUncertain).toBe(true);
      expect(result.metrics.transferTaskPassRate).not.toBeNull();
      expect(result.metrics.cohortMetrics.some((cohort) => cohort.taskSplit === "transfer")).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
