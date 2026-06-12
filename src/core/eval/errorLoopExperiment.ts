import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultConfig } from "../../config/defaultConfig.js";
import { redactText } from "../../safety/secretScanner.js";
import { makeId } from "../../utils/ids.js";
import { runOfflineGraph } from "../agentGraph/executor.js";
import type { AgentGraphState } from "../agentGraph/state.js";
import { saveSession } from "../memory/sessionMemory.js";
import { explainFailureMemories, readFailureMemories, type FailureMemoryExplanation, type FailureMemoryRecord } from "../memory/taskMemory.js";
import type { MemoryRetrievalPolicyMode } from "../memory/retrievalPolicy.js";
import { defaultExperimentTasks, fixtureCatalogHash, resolveExperimentFixture, type ExperimentFixtureMetadata } from "./experimentFixtures.js";

export type ErrorLoopAblation =
  | "memory_on"
  | "memory_off"
  | "write_only"
  | "retrieve_only"
  | "success_memory_only"
  | "failure_memory_only"
  | "random_memory_control";
export type ErrorLoopBaselineMode =
  | "direct"
  | "reflection_only"
  | "preference_feedback"
  | "error_memory";
export type ErrorLoopMode = ErrorLoopAblation | ErrorLoopBaselineMode;
export type MemoryUpdateReason =
  | "written"
  | "skipped_no_failure"
  | "skipped_low_confidence"
  | "skipped_privacy"
  | "skipped_ablation"
  | "skipped_duplicate";

export type ErrorLoopExperimentOptions = {
  tasks?: string[];
  repetitions?: number;
  ablations?: ErrorLoopMode[];
  seed?: string;
  outputDir?: string;
  memoryPolicy?: MemoryRetrievalPolicyMode;
};

export type ErrorLoopTrial = {
  schemaVersion: "error-loop-trial/v1";
  trialId: string;
  taskId: string;
  task: string;
  taskFamily: string;
  taskSplit: "train" | "validation" | "transfer";
  latentFailureType: string;
  language: string;
  validatorUncertain: boolean;
  repetition: number;
  requestedMode: ErrorLoopMode;
  baselineMode: ErrorLoopBaselineMode | null;
  ablation: ErrorLoopAblation;
  sessionId: string;
  sessionPath: string;
  result: string;
  memoryUpdateStatus: MemoryUpdateReason;
  memoryRecordIds: string[];
  retrievalSelected: number;
  retrievalRejected: number;
  traceCompletenessScore?: number;
  eventCount: number;
  artifactCount: number;
  failureClass?: string;
  predictionMatched: number;
  predictionTotal: number;
  predictionAccuracy: number | null;
  memoryPolicyExploit: number;
  memoryPolicyBypass: number;
  firstFailureIndex: number | null;
  recoveryAttemptsAfterFirstFailure: number;
  validationPassed: boolean;
  validationFailed: boolean;
  repeatedSameClassError: boolean;
  repairSuccessAfterRetrieval: boolean;
  estimatedCostUsd: number | null;
  timeToRecoveryMs: number | null;
  transferTask: boolean;
  transferTaskPassed: boolean | null;
  hiddenValidationPassed: boolean | null;
};

export type ErrorLoopMetrics = {
  schemaVersion: "error-loop-metrics/v1";
  trials: number;
  failures: number;
  completed: number;
  memoryWritten: number;
  memoryOccurrences: number;
  memorySkipped: Record<MemoryUpdateReason, number>;
  retrievalDecisions: number;
  suspectedNegativeTransfer: number;
  predictionAccuracy: number | null;
  memoryPolicyExploit: number;
  memoryPolicyBypass: number;
  recoveryAttemptsAfterFirstFailureTotal: number;
  averageRecoveryAttemptsAfterFirstFailure: number | null;
  repeatedSameClassErrorRate: number | null;
  validationPassRate: number;
  transferTaskPassRate: number | null;
  averageCostToRecoveryUsd: number | null;
  averageTimeToRecoveryMs: number | null;
  memoryRetrievalPrecision: number | null;
  harmfulRetrievalRate: number | null;
  repairSuccessAfterRetrievalRate: number | null;
  leakage: {
    checked: boolean;
    violations: number;
    tokensChecked: number;
  };
  cohortMetrics: ErrorLoopCohortMetric[];
  averageTraceCompleteness?: number;
};

export type ErrorLoopCohortMetric = {
  schemaVersion: "error-loop-cohort/v1";
  key: string;
  ablation: ErrorLoopAblation;
  taskFamily: string;
  taskSplit: "train" | "validation" | "transfer";
  failureClass: string;
  trials: number;
  validationPassRate: number;
  recoveryAttemptsMean: number | null;
  recoveryAttemptsVariance: number | null;
  recoveryAttemptsCi95: number | null;
  costMeanUsd: number | null;
  elapsedMeanMs: number | null;
  insufficientData: boolean;
};

export type ErrorLoopExperimentResult = {
  schemaVersion: "error-loop-experiment/v1";
  id: string;
  createdAt: string;
  outputDir: string;
  manifestPath: string;
  reportPath: string;
  trialsPath: string;
  metricsPath: string;
  memoryRecordsPath: string;
  retrievalDecisionsPath: string;
  cohortMetricsPath: string;
  metrics: ErrorLoopMetrics;
  trials: ErrorLoopTrial[];
};

type RetrievalDecisionRow = {
  schemaVersion: "error-loop-retrieval/v1";
  trialId: string;
  task: string;
  requestedMode: ErrorLoopMode;
  baselineMode: ErrorLoopBaselineMode | null;
  ablation: ErrorLoopAblation;
  memoryPolicy: MemoryRetrievalPolicyMode;
  selected: FailureMemoryExplanation["selected"];
  rejected: FailureMemoryExplanation["rejected"];
};

type MemoryRecordExportRow = {
  schemaVersion: "error-loop-memory-export/v1";
  trialId?: string;
  model_visible: FailureMemoryRecord;
  evaluator_only: {
    fixtureId: string;
    hiddenValidatorCount: number;
    leakageTokensChecked: number;
  };
};

type AblationSettings = {
  strategyMemoryEnabled: boolean;
  failureMemoryWriteEnabled: boolean;
  preferSuccessfulRoutes: boolean;
  suggestTestCommand: boolean;
  injectFailureCorrections: boolean;
  memoryPolicyOverride?: MemoryRetrievalPolicyMode;
};

const defaultTasks = defaultExperimentTasks();
const baselineModeMap: Record<ErrorLoopBaselineMode, ErrorLoopAblation> = {
  direct: "memory_off",
  reflection_only: "success_memory_only",
  preference_feedback: "retrieve_only",
  error_memory: "memory_on"
};

type ErrorLoopModeSelection = {
  requestedMode: ErrorLoopMode;
  baselineMode: ErrorLoopBaselineMode | null;
  ablation: ErrorLoopAblation;
};

export async function runErrorLoopExperiment(cwd: string, options: ErrorLoopExperimentOptions = {}): Promise<ErrorLoopExperimentResult> {
  const id = makeId("error_loop");
  const createdAt = new Date().toISOString();
  const outputDir = path.resolve(cwd, options.outputDir ?? path.join(".tomorrowedge", "experiments", "error-loop", id));
  const tasks = normalizeTasks(options.tasks);
  const repetitions = clampPositiveInt(options.repetitions ?? 1, 1, 20);
  const modeSelections = normalizeExperimentModes(options.ablations);
  const requestedModes = modeSelections.map((selection) => selection.requestedMode);
  const ablations = [...new Set(modeSelections.map((selection) => selection.ablation))];
  const memoryPolicy = options.memoryPolicy ?? defaultConfig.strategy_memory.policy;
  const trials: ErrorLoopTrial[] = [];
  const memoryRecords: FailureMemoryRecord[] = [];
  const retrievalDecisions: RetrievalDecisionRow[] = [];

  await mkdir(outputDir, { recursive: true });
  await mkdir(path.join(outputDir, "sessions"), { recursive: true });
  await mkdir(path.join(outputDir, "workspaces"), { recursive: true });

  let index = 0;
  for (const modeSelection of modeSelections) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      for (const task of tasks) {
        index += 1;
        const trialId = `trial_${String(index).padStart(3, "0")}`;
        const fixture = resolveExperimentFixture(task);
        const trial = await runTrial({
          outputDir,
          trialId,
          task: fixture.task,
          fixture,
          repetition,
          modeSelection,
          memoryPolicy
        });
        trials.push(trial.trial);
        memoryRecords.push(...trial.memoryRecords);
        retrievalDecisions.push(trial.retrievalDecision);
      }
    }
  }

  const memoryExports = buildMemoryExports(memoryRecords, trials);
  const leakage = checkMemoryLeakage(memoryExports);
  const metrics = buildMetrics(trials, retrievalDecisions.length, leakage);
  const manifestPath = path.join(outputDir, "manifest.json");
  const trialsPath = path.join(outputDir, "trials.jsonl");
  const metricsPath = path.join(outputDir, "metrics.json");
  const memoryRecordsPath = path.join(outputDir, "memory_records.jsonl");
  const retrievalDecisionsPath = path.join(outputDir, "retrieval_decisions.jsonl");
  const cohortMetricsPath = path.join(outputDir, "cohort_metrics.json");
  const reportPath = path.join(outputDir, "report.md");
  const manifest = {
    schemaVersion: "error-loop-manifest/v1",
    id,
    createdAt,
    seed: options.seed ?? "deterministic-fixture",
    tasks: tasks.map((task) => {
      const fixture = resolveExperimentFixture(task);
      return {
        id: fixture.id,
        prompt: redactText(fixture.modelVisible.prompt),
        split: fixture.split,
        taskFamily: fixture.taskFamily,
        latentFailureType: fixture.latentFailureType,
        language: fixture.language,
        surface: fixture.surface,
        visibleValidators: fixture.modelVisible.visibleValidators,
        hiddenValidatorCount: fixture.evaluatorOnly.hiddenValidators.length
      };
    }),
    repetitions,
    requestedModes,
    ablations,
    baselineModeMap,
    modeSelections,
    ablationSettings: Object.fromEntries(ablations.map((ablation) => [ablation, ablationSettings(ablation)])),
    memoryPolicy,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      commitSha: gitCommitSha(cwd) ?? "unknown",
      fixtureCatalogHash: fixtureCatalogHash(),
      rerunFromManifest: "partial: deterministic fixture inputs are captured; live provider replay requires external provider state."
    },
    redaction: {
      applied: true,
      note: "Goals, records, and artifacts are passed through TomorrowEdge redaction before export rows are written."
    },
    files: {
      trials: path.basename(trialsPath),
      metrics: path.basename(metricsPath),
      memoryRecords: path.basename(memoryRecordsPath),
      retrievalDecisions: path.basename(retrievalDecisionsPath),
      cohortMetrics: path.basename(cohortMetricsPath),
      report: path.basename(reportPath)
    }
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(trialsPath, jsonl(trials), "utf8");
  await writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
  await writeFile(memoryRecordsPath, jsonl(memoryExports), "utf8");
  await writeFile(retrievalDecisionsPath, jsonl(retrievalDecisions), "utf8");
  await writeFile(cohortMetricsPath, `${JSON.stringify(metrics.cohortMetrics, null, 2)}\n`, "utf8");
  await writeFile(reportPath, renderErrorLoopReport({ id, createdAt, tasks, repetitions, requestedModes, modeSelections, ablations, memoryPolicy, metrics, trials }), "utf8");

  return {
    schemaVersion: "error-loop-experiment/v1",
    id,
    createdAt,
    outputDir,
    manifestPath,
    reportPath,
    trialsPath,
    metricsPath,
    memoryRecordsPath,
    retrievalDecisionsPath,
    cohortMetricsPath,
    metrics,
    trials
  };
}

export function renderErrorLoopReport(input: {
  id: string;
  createdAt: string;
  tasks: string[];
  repetitions: number;
  requestedModes: ErrorLoopMode[];
  modeSelections: ErrorLoopModeSelection[];
  ablations: ErrorLoopAblation[];
  memoryPolicy: MemoryRetrievalPolicyMode;
  metrics: ErrorLoopMetrics;
  trials: ErrorLoopTrial[];
}): string {
  const skippedRows = Object.entries(input.metrics.memorySkipped)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `- ${reason}: ${count}`)
    .join("\n") || "- none";
  const baselineRows = input.modeSelections
    .filter((selection) => selection.baselineMode)
    .map((selection) => `- ${selection.requestedMode} -> ${selection.ablation}`)
    .join("\n") || "- none";
  return `# Error-Loop Experiment ${input.id}

Created: ${input.createdAt}

This deterministic no-key experiment is intended to inspect TomorrowEdge failure
memory and retrieval behavior. It is not a live provider benchmark.

## Inputs

- Tasks: ${input.tasks.map((task) => `\`${redactText(task)}\``).join(", ")}
- Repetitions: ${input.repetitions}
- Requested modes: ${input.requestedModes.join(", ")}
- Ablations: ${input.ablations.join(", ")}
- Memory policy: ${input.memoryPolicy}

## Baseline Modes

${baselineRows}

## Metrics

| Trials | Completed | Failures | Memory written | Occurrences | Retrieval decisions | Policy exploit/bypass | Suspected negative transfer | Prediction accuracy | Avg trace |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ${input.metrics.trials} | ${input.metrics.completed} | ${input.metrics.failures} | ${input.metrics.memoryWritten} | ${input.metrics.memoryOccurrences} | ${input.metrics.retrievalDecisions} | ${input.metrics.memoryPolicyExploit}/${input.metrics.memoryPolicyBypass} | ${input.metrics.suspectedNegativeTransfer} | ${input.metrics.predictionAccuracy === null ? "-" : `${(input.metrics.predictionAccuracy * 100).toFixed(1)}%`} | ${input.metrics.averageTraceCompleteness?.toFixed(1) ?? "-"} |

## Primary Hypothesis Metrics

| Recovery attempts | Repeated same-class error rate | Validation pass rate | Transfer pass rate | Avg cost to recovery | Avg time to recovery |
| ---: | ---: | ---: | ---: | ---: | ---: |
| ${input.metrics.recoveryAttemptsAfterFirstFailureTotal} total / ${formatNullable(input.metrics.averageRecoveryAttemptsAfterFirstFailure)} avg | ${formatPercent(input.metrics.repeatedSameClassErrorRate)} | ${formatPercent(input.metrics.validationPassRate)} | ${formatPercent(input.metrics.transferTaskPassRate)} | ${formatUsd(input.metrics.averageCostToRecoveryUsd)} | ${formatMs(input.metrics.averageTimeToRecoveryMs)} |

## Secondary Hypothesis Metrics

| Retrieval precision | Harmful retrieval rate | Repair success after retrieval |
| ---: | ---: | ---: |
| ${formatPercent(input.metrics.memoryRetrievalPrecision)} | ${formatPercent(input.metrics.harmfulRetrievalRate)} | ${formatPercent(input.metrics.repairSuccessAfterRetrievalRate)} |

## Leakage Guard

- Checked: ${input.metrics.leakage.checked ? "yes" : "no"}
- Tokens checked: ${input.metrics.leakage.tokensChecked}
- Violations: ${input.metrics.leakage.violations}

## Cohorts

| Cohort | Trials | Pass rate | Recovery mean | Recovery CI95 | Cost mean | Insufficient |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
${input.metrics.cohortMetrics.map((cohort) => `| ${cohort.key} | ${cohort.trials} | ${formatPercent(cohort.validationPassRate)} | ${formatNullable(cohort.recoveryAttemptsMean)} | ${formatNullable(cohort.recoveryAttemptsCi95)} | ${formatUsd(cohort.costMeanUsd)} | ${cohort.insufficientData ? "yes" : "no"} |`).join("\n") || "| - | 0 | - | - | - | - | yes |"}

## Memory Update Status

${skippedRows}

## Trials

| Trial | Split | Family | Requested mode | Ablation | Result | Memory update | Retrieval | Policy | Recovery | Validation | Prediction | Failure class |
| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | --- | ---: | --- |
${input.trials.map((trial) => `| ${trial.trialId} | ${trial.taskSplit} | ${trial.taskFamily} | ${trial.requestedMode} | ${trial.ablation} | ${trial.result} | ${trial.memoryUpdateStatus} | ${trial.retrievalSelected}/${trial.retrievalRejected} | ${trial.memoryPolicyExploit}/${trial.memoryPolicyBypass} | ${trial.recoveryAttemptsAfterFirstFailure} | ${trial.validationPassed ? "passed" : trial.validationFailed ? "failed" : "not_run"} | ${trial.predictionTotal ? `${trial.predictionMatched}/${trial.predictionTotal}` : "-"} | ${trial.failureClass ?? "-"} |`).join("\n")}
`;
}

async function runTrial(input: {
  outputDir: string;
  trialId: string;
  task: string;
  fixture: ExperimentFixtureMetadata;
  repetition: number;
  modeSelection: ErrorLoopModeSelection;
  memoryPolicy: MemoryRetrievalPolicyMode;
}): Promise<{ trial: ErrorLoopTrial; memoryRecords: FailureMemoryRecord[]; retrievalDecision: RetrievalDecisionRow }> {
  const trialCwd = path.join(input.outputDir, "workspaces", input.trialId);
  await mkdir(trialCwd, { recursive: true });
  const settings = ablationSettings(input.modeSelection.ablation);
  const config = {
    ...defaultConfig,
    strategy_memory: {
      ...defaultConfig.strategy_memory,
      enabled: settings.strategyMemoryEnabled,
      policy: settings.memoryPolicyOverride ?? input.memoryPolicy,
      prefer_successful_routes: settings.preferSuccessfulRoutes,
      suggest_test_command: settings.suggestTestCommand,
      failure_premortem: settings.injectFailureCorrections,
      coder_constraints: settings.injectFailureCorrections,
      review_guard: settings.injectFailureCorrections,
      repair_context: settings.injectFailureCorrections
    },
    failure_memory: {
      ...defaultConfig.failure_memory,
      enabled: settings.failureMemoryWriteEnabled,
      storage_scope: "experiment" as const,
      redaction: "artifact_refs" as const,
      retention_days: 30
    }
  };
  const state = await runOfflineGraph(trialCwd, input.task, config, { fixtureMode: true, provider: "fixture" });
  const failure = state.finalSummary?.result !== "completed";
  let sessionPath = path.join(input.outputDir, "sessions", `${input.trialId}.json`);
  let memoryRecords: FailureMemoryRecord[] = [];
  let memoryUpdateStatus: MemoryUpdateReason = "skipped_no_failure";

  if (settings.failureMemoryWriteEnabled) {
    const before = await readFailureMemories(trialCwd, 200);
    const beforeById = new Map(before.map((record) => [record.id, record]));
    sessionPath = await saveSession(trialCwd, state, { failureMemory: { ...config.failure_memory, experimentId: path.basename(input.outputDir) } });
    const after = await readFailureMemories(trialCwd, 200);
    const newRecords = after.filter((record) => !beforeById.has(record.id));
    const updatedRecords = after.filter((record) => {
      const previous = beforeById.get(record.id);
      return previous && record.recurrenceCount > previous.recurrenceCount;
    });
    memoryRecords = newRecords.length ? newRecords : updatedRecords;
    memoryUpdateStatus = memoryStatusFor(failure, newRecords, updatedRecords);
  } else {
    await writeFile(sessionPath, `${JSON.stringify(minimalSessionExport(state), null, 2)}\n`, "utf8");
    memoryUpdateStatus = "skipped_ablation";
  }

  const retrieval = settings.strategyMemoryEnabled
    ? await explainFailureMemories(trialCwd, input.task, { limit: 5 })
    : { task: redactText(input.task), selected: [], rejected: [] };
  const retrievalDecision: RetrievalDecisionRow = {
    schemaVersion: "error-loop-retrieval/v1",
    trialId: input.trialId,
    task: redactText(input.task),
    requestedMode: input.modeSelection.requestedMode,
    baselineMode: input.modeSelection.baselineMode,
    ablation: input.modeSelection.ablation,
    memoryPolicy: settings.memoryPolicyOverride ?? input.memoryPolicy,
    selected: retrieval.selected,
    rejected: retrieval.rejected
  };
  const [firstFailure] = memoryRecords;
  const prediction = predictionStats(state);
  const policyStats = memoryPolicyStats(state);
  const outcome = trialOutcomeStats(state, firstFailure);
  return {
    trial: {
      schemaVersion: "error-loop-trial/v1",
      trialId: input.trialId,
      taskId: input.fixture.id,
      task: redactText(input.task),
      taskFamily: input.fixture.taskFamily,
      taskSplit: input.fixture.split,
      latentFailureType: input.fixture.latentFailureType,
      language: input.fixture.language,
      validatorUncertain: input.fixture.surface === "flaky" || firstFailure?.outcomeMismatchType === "flaky_result",
      repetition: input.repetition,
      requestedMode: input.modeSelection.requestedMode,
      baselineMode: input.modeSelection.baselineMode,
      ablation: input.modeSelection.ablation,
      sessionId: state.sessionId,
      sessionPath,
      result: state.finalSummary?.result ?? "unknown",
      memoryUpdateStatus,
      memoryRecordIds: memoryRecords.map((record) => record.id),
      retrievalSelected: retrieval.selected.length,
      retrievalRejected: retrieval.rejected.length,
      traceCompletenessScore: state.traceCompleteness?.score,
      eventCount: state.events.length,
      artifactCount: state.eventArtifacts.length,
      failureClass: firstFailure?.failureClass,
      predictionMatched: prediction.matched,
      predictionTotal: prediction.total,
      predictionAccuracy: prediction.total ? prediction.matched / prediction.total : null,
      memoryPolicyExploit: policyStats.exploit,
      memoryPolicyBypass: policyStats.bypass,
      firstFailureIndex: outcome.firstFailureIndex,
      recoveryAttemptsAfterFirstFailure: outcome.recoveryAttemptsAfterFirstFailure,
      validationPassed: outcome.validationPassed,
      validationFailed: outcome.validationFailed,
      repeatedSameClassError: outcome.repeatedSameClassError,
      repairSuccessAfterRetrieval: outcome.repairSuccessAfterRetrieval,
      estimatedCostUsd: state.usageSummary.estimatedCostUsd ?? null,
      timeToRecoveryMs: outcome.timeToRecoveryMs,
      transferTask: input.fixture.split === "transfer",
      transferTaskPassed: input.fixture.split === "transfer" ? outcome.validationPassed : null,
      hiddenValidationPassed: input.fixture.evaluatorOnly.hiddenValidators.length ? outcome.validationPassed : null
    },
    memoryRecords,
    retrievalDecision
  };
}

function memoryStatusFor(failure: boolean, newRecords: FailureMemoryRecord[], updatedRecords: FailureMemoryRecord[]): MemoryUpdateReason {
  if (!failure) return "skipped_no_failure";
  if (newRecords.length) return "written";
  if (updatedRecords.length) return "skipped_duplicate";
  return "skipped_low_confidence";
}

function buildMetrics(trials: ErrorLoopTrial[], retrievalDecisions: number, leakage: ErrorLoopMetrics["leakage"]): ErrorLoopMetrics {
  const memorySkipped = emptySkippedCounts();
  for (const trial of trials) {
    if (trial.memoryUpdateStatus !== "written") memorySkipped[trial.memoryUpdateStatus] += 1;
  }
  const traceScores = trials.map((trial) => trial.traceCompletenessScore).filter((score): score is number => typeof score === "number");
  const predictionMatched = trials.reduce((sum, trial) => sum + trial.predictionMatched, 0);
  const predictionTotal = trials.reduce((sum, trial) => sum + trial.predictionTotal, 0);
  const memoryPolicyExploit = trials.reduce((sum, trial) => sum + trial.memoryPolicyExploit, 0);
  const memoryPolicyBypass = trials.reduce((sum, trial) => sum + trial.memoryPolicyBypass, 0);
  const recoveryAttemptsAfterFirstFailureTotal = trials.reduce((sum, trial) => sum + trial.recoveryAttemptsAfterFirstFailure, 0);
  const failedTrials = trials.filter((trial) => trial.validationFailed);
  const retrievalTrials = trials.filter((trial) => trial.retrievalSelected > 0);
  const repairRetrievalTrials = retrievalTrials.filter((trial) => trial.recoveryAttemptsAfterFirstFailure > 0);
  const completedCosts = trials.filter((trial) => trial.result === "completed" && trial.estimatedCostUsd !== null).map((trial) => trial.estimatedCostUsd!);
  const recoveryTimes = trials.map((trial) => trial.timeToRecoveryMs).filter((value): value is number => value !== null);
  const retrievalSelected = trials.reduce((sum, trial) => sum + trial.retrievalSelected, 0);
  const retrievalRejected = trials.reduce((sum, trial) => sum + trial.retrievalRejected, 0);
  const transferTrials = trials.filter((trial) => trial.transferTask);
  return {
    schemaVersion: "error-loop-metrics/v1",
    trials: trials.length,
    failures: trials.filter((trial) => trial.result !== "completed").length,
    completed: trials.filter((trial) => trial.result === "completed").length,
    memoryWritten: trials.filter((trial) => trial.memoryUpdateStatus === "written").length,
    memoryOccurrences: trials.reduce((sum, trial) => sum + trial.memoryRecordIds.length, 0),
    memorySkipped,
    retrievalDecisions,
    suspectedNegativeTransfer: trials.filter((trial) => trial.retrievalSelected > 0 && trial.result !== "completed").length,
    predictionAccuracy: predictionTotal ? predictionMatched / predictionTotal : null,
    memoryPolicyExploit,
    memoryPolicyBypass,
    recoveryAttemptsAfterFirstFailureTotal,
    averageRecoveryAttemptsAfterFirstFailure: failedTrials.length ? recoveryAttemptsAfterFirstFailureTotal / failedTrials.length : null,
    repeatedSameClassErrorRate: failedTrials.length ? failedTrials.filter((trial) => trial.repeatedSameClassError).length / failedTrials.length : null,
    validationPassRate: trials.length ? trials.filter((trial) => trial.validationPassed).length / trials.length : 0,
    transferTaskPassRate: transferTrials.length ? transferTrials.filter((trial) => trial.transferTaskPassed).length / transferTrials.length : null,
    averageCostToRecoveryUsd: averageOrNull(completedCosts),
    averageTimeToRecoveryMs: averageOrNull(recoveryTimes),
    memoryRetrievalPrecision: retrievalSelected + retrievalRejected ? retrievalSelected / (retrievalSelected + retrievalRejected) : null,
    harmfulRetrievalRate: retrievalTrials.length ? retrievalTrials.filter((trial) => trial.result !== "completed").length / retrievalTrials.length : null,
    repairSuccessAfterRetrievalRate: repairRetrievalTrials.length ? repairRetrievalTrials.filter((trial) => trial.repairSuccessAfterRetrieval).length / repairRetrievalTrials.length : null,
    leakage,
    cohortMetrics: buildCohortMetrics(trials),
    averageTraceCompleteness: traceScores.length ? traceScores.reduce((sum, score) => sum + score, 0) / traceScores.length : undefined
  };
}

function buildCohortMetrics(trials: ErrorLoopTrial[]): ErrorLoopCohortMetric[] {
  const groups = new Map<string, ErrorLoopTrial[]>();
  for (const trial of trials) {
    const key = [
      trial.ablation,
      trial.taskFamily,
      trial.taskSplit,
      trial.failureClass ?? "unknown"
    ].join("|");
    groups.set(key, [...(groups.get(key) ?? []), trial]);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const [ablation, taskFamily, taskSplit, failureClass] = key.split("|") as [ErrorLoopAblation, string, ErrorLoopTrial["taskSplit"], string];
    const recoveryAttempts = rows.map((row) => row.recoveryAttemptsAfterFirstFailure);
    const costs = rows.map((row) => row.estimatedCostUsd).filter((value): value is number => value !== null);
    const elapsed = rows.map((row) => row.timeToRecoveryMs).filter((value): value is number => value !== null);
    const variance = varianceOrNull(recoveryAttempts);
    return {
      schemaVersion: "error-loop-cohort/v1" as const,
      key,
      ablation,
      taskFamily,
      taskSplit,
      failureClass,
      trials: rows.length,
      validationPassRate: rows.filter((row) => row.validationPassed).length / rows.length,
      recoveryAttemptsMean: averageOrNull(recoveryAttempts),
      recoveryAttemptsVariance: variance,
      recoveryAttemptsCi95: ci95(recoveryAttempts),
      costMeanUsd: averageOrNull(costs),
      elapsedMeanMs: averageOrNull(elapsed),
      insufficientData: rows.length < 2
    };
  }).sort((a, b) => a.key.localeCompare(b.key));
}

function trialOutcomeStats(state: AgentGraphState, firstFailure: FailureMemoryRecord | undefined): {
  firstFailureIndex: number | null;
  recoveryAttemptsAfterFirstFailure: number;
  validationPassed: boolean;
  validationFailed: boolean;
  repeatedSameClassError: boolean;
  repairSuccessAfterRetrieval: boolean;
  timeToRecoveryMs: number | null;
} {
  const firstFailureIndex = state.runResults.findIndex((run) => !run.success && !run.skipped);
  const validationPassed = state.runResults.some((run) => run.success && !run.skipped);
  const validationFailed = firstFailureIndex >= 0;
  const runsAfterFailure = firstFailureIndex >= 0 ? state.runResults.slice(firstFailureIndex + 1) : [];
  const recoveryIndex = runsAfterFailure.findIndex((run) => run.success && !run.skipped);
  const recoveryWindow = recoveryIndex >= 0 ? runsAfterFailure.slice(0, recoveryIndex + 1) : [];
  const repairContextUsed = state.events.some((event) =>
    event.type === "memory_retrieval" &&
    event.retrievalStage === "repair_context" &&
    event.selectedMemoryIds.length > 0
  );
  const repeatedPolicy = state.events.some((event) => event.type === "repair_policy" && event.occurrence > 1);
  return {
    firstFailureIndex: firstFailureIndex >= 0 ? firstFailureIndex : null,
    recoveryAttemptsAfterFirstFailure: runsAfterFailure.length,
    validationPassed,
    validationFailed,
    repeatedSameClassError: repeatedPolicy || (firstFailure?.recurrenceCount ?? 0) > 1,
    repairSuccessAfterRetrieval: repairContextUsed && recoveryIndex >= 0,
    timeToRecoveryMs: recoveryWindow.length ? recoveryWindow.reduce((sum, run) => sum + run.durationMs, 0) : null
  };
}

function buildMemoryExports(records: FailureMemoryRecord[], trials: ErrorLoopTrial[]): MemoryRecordExportRow[] {
  const trialByMemoryId = new Map<string, ErrorLoopTrial>();
  for (const trial of trials) {
    for (const id of trial.memoryRecordIds) trialByMemoryId.set(id, trial);
  }
  return records.map((record) => {
    const trial = trialByMemoryId.get(record.id);
    const fixture = resolveExperimentFixture(trial?.taskId ?? trial?.task ?? record.goalPreview ?? "");
    return {
      schemaVersion: "error-loop-memory-export/v1",
      trialId: trial?.trialId,
      model_visible: record,
      evaluator_only: {
        fixtureId: fixture.id,
        hiddenValidatorCount: fixture.evaluatorOnly.hiddenValidators.length,
        leakageTokensChecked: fixture.evaluatorOnly.leakageTokens.length
      }
    };
  });
}

function checkMemoryLeakage(rows: MemoryRecordExportRow[]): ErrorLoopMetrics["leakage"] {
  let tokensChecked = 0;
  const violations: string[] = [];
  for (const row of rows) {
    const fixture = resolveExperimentFixture(row.evaluator_only.fixtureId);
    const visibleText = JSON.stringify(row.model_visible).toLowerCase();
    for (const token of fixture.evaluatorOnly.leakageTokens) {
      tokensChecked += 1;
      if (token && visibleText.includes(token.toLowerCase())) {
        violations.push(`${row.trialId ?? "unknown"}:${fixture.id}:${token}`);
      }
    }
  }
  if (violations.length) {
    throw new Error(`Experiment leakage guard failed: evaluator-only token(s) leaked into model-visible memory: ${violations.slice(0, 5).join(", ")}`);
  }
  return {
    checked: rows.length > 0,
    violations: 0,
    tokensChecked
  };
}

function gitCommitSha(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function memoryPolicyStats(state: AgentGraphState): { exploit: number; bypass: number } {
  const decisions = state.events.filter((event) => event.type === "memory_policy");
  return {
    exploit: decisions.filter((event) => event.action === "exploit").length,
    bypass: decisions.filter((event) => event.action === "bypass").length
  };
}

function predictionStats(state: AgentGraphState): { matched: number; total: number } {
  const observations = state.events.filter((event) => event.type === "outcome_observation");
  return {
    matched: observations.filter((event) => event.matched).length,
    total: observations.length
  };
}

function averageOrNull(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function varianceOrNull(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = averageOrNull(values) ?? 0;
  return values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1);
}

function ci95(values: number[]): number | null {
  if (values.length < 2) return null;
  const variance = varianceOrNull(values);
  if (variance === null) return null;
  return 1.96 * Math.sqrt(variance / values.length);
}

function formatNullable(value: number | null): string {
  return value === null ? "-" : value.toFixed(2);
}

function formatPercent(value: number | null): string {
  return value === null ? "-" : `${(value * 100).toFixed(1)}%`;
}

function formatUsd(value: number | null): string {
  return value === null ? "-" : `$${value.toFixed(6)}`;
}

function formatMs(value: number | null): string {
  return value === null ? "-" : `${Math.round(value)}ms`;
}

function emptySkippedCounts(): Record<MemoryUpdateReason, number> {
  return {
    written: 0,
    skipped_no_failure: 0,
    skipped_low_confidence: 0,
    skipped_privacy: 0,
    skipped_ablation: 0,
    skipped_duplicate: 0
  };
}

function normalizeTasks(tasks: string[] | undefined): string[] {
  const values = (tasks?.length ? tasks : defaultTasks).map((task) => redactText(task.trim())).filter(Boolean);
  return values.length ? values : defaultTasks;
}

function normalizeExperimentModes(value: ErrorLoopMode[] | undefined): ErrorLoopModeSelection[] {
  const raw = value?.length ? value : ["memory_on"];
  const seen = new Set<ErrorLoopMode>();
  const selections = raw
    .filter(isErrorLoopMode)
    .filter((mode) => {
      if (seen.has(mode)) return false;
      seen.add(mode);
      return true;
    })
    .map((mode) => {
      const baselineMode = isErrorLoopBaselineMode(mode) ? mode : null;
      const ablation: ErrorLoopAblation = baselineMode ? baselineModeMap[baselineMode] : mode as ErrorLoopAblation;
      return {
        requestedMode: mode,
        baselineMode,
        ablation
      };
    });
  return selections.length ? selections : [{ requestedMode: "memory_on", baselineMode: null, ablation: "memory_on" }];
}

export function isErrorLoopAblation(value: string): value is ErrorLoopAblation {
  return [
    "memory_on",
    "memory_off",
    "write_only",
    "retrieve_only",
    "success_memory_only",
    "failure_memory_only",
    "random_memory_control"
  ].includes(value);
}

export function isErrorLoopBaselineMode(value: string): value is ErrorLoopBaselineMode {
  return Object.prototype.hasOwnProperty.call(baselineModeMap, value);
}

export function isErrorLoopMode(value: string): value is ErrorLoopMode {
  return isErrorLoopAblation(value) || isErrorLoopBaselineMode(value);
}

function ablationSettings(ablation: ErrorLoopAblation): AblationSettings {
  switch (ablation) {
    case "memory_on":
      return {
        strategyMemoryEnabled: true,
        failureMemoryWriteEnabled: true,
        preferSuccessfulRoutes: true,
        suggestTestCommand: true,
        injectFailureCorrections: true
      };
    case "memory_off":
      return {
        strategyMemoryEnabled: false,
        failureMemoryWriteEnabled: false,
        preferSuccessfulRoutes: false,
        suggestTestCommand: false,
        injectFailureCorrections: false
      };
    case "write_only":
      return {
        strategyMemoryEnabled: false,
        failureMemoryWriteEnabled: true,
        preferSuccessfulRoutes: false,
        suggestTestCommand: false,
        injectFailureCorrections: false
      };
    case "retrieve_only":
      return {
        strategyMemoryEnabled: true,
        failureMemoryWriteEnabled: false,
        preferSuccessfulRoutes: false,
        suggestTestCommand: false,
        injectFailureCorrections: true
      };
    case "success_memory_only":
      return {
        strategyMemoryEnabled: true,
        failureMemoryWriteEnabled: false,
        preferSuccessfulRoutes: true,
        suggestTestCommand: true,
        injectFailureCorrections: false
      };
    case "failure_memory_only":
      return {
        strategyMemoryEnabled: true,
        failureMemoryWriteEnabled: true,
        preferSuccessfulRoutes: false,
        suggestTestCommand: false,
        injectFailureCorrections: true
      };
    case "random_memory_control":
      return {
        strategyMemoryEnabled: true,
        failureMemoryWriteEnabled: true,
        preferSuccessfulRoutes: false,
        suggestTestCommand: false,
        injectFailureCorrections: true,
        memoryPolicyOverride: "random_control"
      };
  }
}

function clampPositiveInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function jsonl(values: unknown[]): string {
  return values.length ? `${values.map((value) => JSON.stringify(value)).join("\n")}\n` : "";
}

function minimalSessionExport(state: AgentGraphState): unknown {
  return {
    schemaVersion: "error-loop-session/v1",
    sessionId: state.sessionId,
    goal: redactText(state.goal),
    result: state.finalSummary?.result ?? "unknown",
    events: state.events,
    eventCount: state.events.length,
    artifactCount: state.eventArtifacts.length,
    traceCompleteness: state.traceCompleteness
  };
}
