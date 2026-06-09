import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultConfig } from "../../config/defaultConfig.js";
import { redactText } from "../../safety/secretScanner.js";
import { makeId } from "../../utils/ids.js";
import { runOfflineGraph } from "../agentGraph/executor.js";
import type { AgentGraphState } from "../agentGraph/state.js";
import { saveSession } from "../memory/sessionMemory.js";
import { explainFailureMemories, readFailureMemories, type FailureMemoryExplanation, type FailureMemoryRecord } from "../memory/taskMemory.js";

export type ErrorLoopAblation = "memory_on" | "memory_off";
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
};

export type ErrorLoopMetrics = {
  schemaVersion: "error-loop-metrics/v1";
  trials: number;
  failures: number;
  completed: number;
  memoryWritten: number;
  memorySkipped: Record<MemoryUpdateReason, number>;
  retrievalDecisions: number;
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
  selected: FailureMemoryExplanation["selected"];
  rejected: FailureMemoryExplanation["rejected"];
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
          ablation
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
  await writeFile(reportPath, renderErrorLoopReport({ id, createdAt, tasks, repetitions, ablations, metrics, trials }), "utf8");

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

## Metrics

| Trials | Completed | Failures | Memory written | Retrieval decisions | Avg trace |
| ---: | ---: | ---: | ---: | ---: | ---: |
| ${input.metrics.trials} | ${input.metrics.completed} | ${input.metrics.failures} | ${input.metrics.memoryWritten} | ${input.metrics.retrievalDecisions} | ${input.metrics.averageTraceCompleteness?.toFixed(1) ?? "-"} |

## Memory Update Status

${skippedRows}

## Trials

| Trial | Ablation | Result | Memory update | Retrieval | Failure class |
| --- | --- | --- | --- | ---: | --- |
${input.trials.map((trial) => `| ${trial.trialId} | ${trial.ablation} | ${trial.result} | ${trial.memoryUpdateStatus} | ${trial.retrievalSelected}/${trial.retrievalRejected} | ${trial.failureClass ?? "-"} |`).join("\n")}
`;
}

async function runTrial(input: {
  outputDir: string;
  trialId: string;
  task: string;
  repetition: number;
  ablation: ErrorLoopAblation;
}): Promise<{ trial: ErrorLoopTrial; memoryRecords: FailureMemoryRecord[]; retrievalDecision: RetrievalDecisionRow }> {
  const trialCwd = path.join(input.outputDir, "workspaces", input.trialId);
  await mkdir(trialCwd, { recursive: true });
  const config = {
    ...defaultConfig,
    strategy_memory: {
      ...defaultConfig.strategy_memory,
      enabled: input.ablation === "memory_on"
    }
  };
  const state = await runOfflineGraph(trialCwd, input.task, config, { fixtureMode: true, provider: "fixture" });
  const failure = state.finalSummary?.result !== "completed";
  let sessionPath = path.join(input.outputDir, "sessions", `${input.trialId}.json`);
  let memoryRecords: FailureMemoryRecord[] = [];
  let memoryUpdateStatus: MemoryUpdateReason = "skipped_no_failure";

  if (input.ablation === "memory_on") {
    const before = await readFailureMemories(trialCwd, 200);
    sessionPath = await saveSession(trialCwd, state);
    const after = await readFailureMemories(trialCwd, 200);
    memoryRecords = after.filter((record) => !before.some((item) => item.id === record.id));
    memoryUpdateStatus = memoryStatusFor(failure, memoryRecords);
  } else {
    await writeFile(sessionPath, `${JSON.stringify(minimalSessionExport(state), null, 2)}\n`, "utf8");
    memoryUpdateStatus = "skipped_ablation";
  }

  const retrieval = input.ablation === "memory_on"
    ? await explainFailureMemories(trialCwd, input.task, { limit: 5 })
    : { task: redactText(input.task), selected: [], rejected: [] };
  const retrievalDecision: RetrievalDecisionRow = {
    schemaVersion: "error-loop-retrieval/v1",
    trialId: input.trialId,
    task: redactText(input.task),
    ablation: input.ablation,
    selected: retrieval.selected,
    rejected: retrieval.rejected
  };
  const [firstFailure] = memoryRecords;
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
      failureClass: firstFailure?.failureClass
    },
    memoryRecords,
    retrievalDecision
  };
}

function memoryStatusFor(failure: boolean, records: FailureMemoryRecord[]): MemoryUpdateReason {
  if (!failure) return "skipped_no_failure";
  if (records.length) return "written";
  return "skipped_low_confidence";
}

function buildMetrics(trials: ErrorLoopTrial[], retrievalDecisions: number): ErrorLoopMetrics {
  const memorySkipped = emptySkippedCounts();
  for (const trial of trials) {
    if (trial.memoryUpdateStatus !== "written") memorySkipped[trial.memoryUpdateStatus] += 1;
  }
  const traceScores = trials.map((trial) => trial.traceCompletenessScore).filter((score): score is number => typeof score === "number");
  return {
    schemaVersion: "error-loop-metrics/v1",
    trials: trials.length,
    failures: trials.filter((trial) => trial.result !== "completed").length,
    completed: trials.filter((trial) => trial.result === "completed").length,
    memoryWritten: trials.filter((trial) => trial.memoryUpdateStatus === "written").length,
    memorySkipped,
    retrievalDecisions,
    averageTraceCompleteness: traceScores.length ? traceScores.reduce((sum, score) => sum + score, 0) / traceScores.length : undefined
  };
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
  return [...new Set(raw.filter((item): item is ErrorLoopAblation => item === "memory_on" || item === "memory_off"))];
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
