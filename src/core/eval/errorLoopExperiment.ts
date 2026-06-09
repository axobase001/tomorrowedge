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

export type ErrorLoopAblation =
  | "memory_on"
  | "memory_off"
  | "write_only"
  | "retrieve_only"
  | "success_memory_only"
  | "failure_memory_only"
  | "random_memory_control";
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
  ablations?: ErrorLoopAblation[];
  seed?: string;
  outputDir?: string;
  memoryPolicy?: MemoryRetrievalPolicyMode;
};

export type ErrorLoopTrial = {
  schemaVersion: "error-loop-trial/v1";
  trialId: string;
  task: string;
  repetition: number;
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
  averageTraceCompleteness?: number;
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
  metrics: ErrorLoopMetrics;
  trials: ErrorLoopTrial[];
};

type RetrievalDecisionRow = {
  schemaVersion: "error-loop-retrieval/v1";
  trialId: string;
  task: string;
  ablation: ErrorLoopAblation;
  memoryPolicy: MemoryRetrievalPolicyMode;
  selected: FailureMemoryExplanation["selected"];
  rejected: FailureMemoryExplanation["rejected"];
};

type AblationSettings = {
  strategyMemoryEnabled: boolean;
  failureMemoryWriteEnabled: boolean;
  preferSuccessfulRoutes: boolean;
  suggestTestCommand: boolean;
  injectFailureCorrections: boolean;
  memoryPolicyOverride?: MemoryRetrievalPolicyMode;
};

const defaultTasks = [
  "fix failing test",
  "repair npm test validation failure in index.js"
];

export async function runErrorLoopExperiment(cwd: string, options: ErrorLoopExperimentOptions = {}): Promise<ErrorLoopExperimentResult> {
  const id = makeId("error_loop");
  const createdAt = new Date().toISOString();
  const outputDir = path.resolve(cwd, options.outputDir ?? path.join(".tomorrowedge", "experiments", "error-loop", id));
  const tasks = normalizeTasks(options.tasks);
  const repetitions = clampPositiveInt(options.repetitions ?? 1, 1, 20);
  const ablations = normalizeAblations(options.ablations);
  const memoryPolicy = options.memoryPolicy ?? defaultConfig.strategy_memory.policy;
  const trials: ErrorLoopTrial[] = [];
  const memoryRecords: FailureMemoryRecord[] = [];
  const retrievalDecisions: RetrievalDecisionRow[] = [];

  await mkdir(outputDir, { recursive: true });
  await mkdir(path.join(outputDir, "sessions"), { recursive: true });
  await mkdir(path.join(outputDir, "workspaces"), { recursive: true });

  let index = 0;
  for (const ablation of ablations) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      for (const task of tasks) {
        index += 1;
        const trialId = `trial_${String(index).padStart(3, "0")}`;
        const trial = await runTrial({
          outputDir,
          trialId,
          task,
          repetition,
          ablation,
          memoryPolicy
        });
        trials.push(trial.trial);
        memoryRecords.push(...trial.memoryRecords);
        retrievalDecisions.push(trial.retrievalDecision);
      }
    }
  }

  const metrics = buildMetrics(trials, retrievalDecisions.length);
  const manifestPath = path.join(outputDir, "manifest.json");
  const trialsPath = path.join(outputDir, "trials.jsonl");
  const metricsPath = path.join(outputDir, "metrics.json");
  const memoryRecordsPath = path.join(outputDir, "memory_records.jsonl");
  const retrievalDecisionsPath = path.join(outputDir, "retrieval_decisions.jsonl");
  const reportPath = path.join(outputDir, "report.md");
  const manifest = {
    schemaVersion: "error-loop-manifest/v1",
    id,
    createdAt,
    seed: options.seed ?? "deterministic-fixture",
    tasks: tasks.map((task) => redactText(task)),
    repetitions,
    ablations,
    ablationSettings: Object.fromEntries(ablations.map((ablation) => [ablation, ablationSettings(ablation)])),
    memoryPolicy,
    redaction: {
      applied: true,
      note: "Goals, records, and artifacts are passed through TomorrowEdge redaction before export rows are written."
    },
    files: {
      trials: path.basename(trialsPath),
      metrics: path.basename(metricsPath),
      memoryRecords: path.basename(memoryRecordsPath),
      retrievalDecisions: path.basename(retrievalDecisionsPath),
      report: path.basename(reportPath)
    }
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(trialsPath, jsonl(trials), "utf8");
  await writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
  await writeFile(memoryRecordsPath, jsonl(memoryRecords), "utf8");
  await writeFile(retrievalDecisionsPath, jsonl(retrievalDecisions), "utf8");
  await writeFile(reportPath, renderErrorLoopReport({ id, createdAt, tasks, repetitions, ablations, memoryPolicy, metrics, trials }), "utf8");

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
    metrics,
    trials
  };
}

export function renderErrorLoopReport(input: {
  id: string;
  createdAt: string;
  tasks: string[];
  repetitions: number;
  ablations: ErrorLoopAblation[];
  memoryPolicy: MemoryRetrievalPolicyMode;
  metrics: ErrorLoopMetrics;
  trials: ErrorLoopTrial[];
}): string {
  const skippedRows = Object.entries(input.metrics.memorySkipped)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `- ${reason}: ${count}`)
    .join("\n") || "- none";
  return `# Error-Loop Experiment ${input.id}

Created: ${input.createdAt}

This deterministic no-key experiment is intended to inspect TomorrowEdge failure
memory and retrieval behavior. It is not a live provider benchmark.

## Inputs

- Tasks: ${input.tasks.map((task) => `\`${redactText(task)}\``).join(", ")}
- Repetitions: ${input.repetitions}
- Ablations: ${input.ablations.join(", ")}
- Memory policy: ${input.memoryPolicy}

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

## Memory Update Status

${skippedRows}

## Trials

| Trial | Ablation | Result | Memory update | Retrieval | Policy | Recovery | Validation | Prediction | Failure class |
| --- | --- | --- | --- | ---: | ---: | ---: | --- | ---: | --- |
${input.trials.map((trial) => `| ${trial.trialId} | ${trial.ablation} | ${trial.result} | ${trial.memoryUpdateStatus} | ${trial.retrievalSelected}/${trial.retrievalRejected} | ${trial.memoryPolicyExploit}/${trial.memoryPolicyBypass} | ${trial.recoveryAttemptsAfterFirstFailure} | ${trial.validationPassed ? "passed" : trial.validationFailed ? "failed" : "not_run"} | ${trial.predictionTotal ? `${trial.predictionMatched}/${trial.predictionTotal}` : "-"} | ${trial.failureClass ?? "-"} |`).join("\n")}
`;
}

async function runTrial(input: {
  outputDir: string;
  trialId: string;
  task: string;
  repetition: number;
  ablation: ErrorLoopAblation;
  memoryPolicy: MemoryRetrievalPolicyMode;
}): Promise<{ trial: ErrorLoopTrial; memoryRecords: FailureMemoryRecord[]; retrievalDecision: RetrievalDecisionRow }> {
  const trialCwd = path.join(input.outputDir, "workspaces", input.trialId);
  await mkdir(trialCwd, { recursive: true });
  const settings = ablationSettings(input.ablation);
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
    ablation: input.ablation,
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
      task: redactText(input.task),
      repetition: input.repetition,
      ablation: input.ablation,
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
      transferTask: false,
      transferTaskPassed: null,
      hiddenValidationPassed: null
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

function buildMetrics(trials: ErrorLoopTrial[], retrievalDecisions: number): ErrorLoopMetrics {
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
    averageTraceCompleteness: traceScores.length ? traceScores.reduce((sum, score) => sum + score, 0) / traceScores.length : undefined
  };
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

function normalizeAblations(value: ErrorLoopAblation[] | undefined): ErrorLoopAblation[] {
  const raw = value?.length ? value : ["memory_on"];
  return [...new Set(raw.filter(isErrorLoopAblation))];
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
