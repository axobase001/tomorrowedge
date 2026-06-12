import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ErrorLoopCohortMetric, ErrorLoopMetrics, ErrorLoopMode, ErrorLoopTrial } from "./errorLoopExperiment.js";

export type ErrorLoopDashboardOptions = {
  inputDir: string;
  outputDir?: string;
};

export type ErrorLoopDashboardResult = {
  schemaVersion: "error-loop-dashboard/v1";
  inputDir: string;
  outputDir: string;
  htmlPath: string;
  summaryPath: string;
  trialCount: number;
  cohortCount: number;
  requestedModes: ErrorLoopMode[];
  ablations: string[];
};

type ErrorLoopManifest = {
  id?: string;
  createdAt?: string;
  requestedModes?: ErrorLoopMode[];
  ablations?: string[];
  modeSelections?: Array<{ requestedMode: string; baselineMode: string | null; ablation: string }>;
  memoryPolicy?: string;
  runtime?: {
    commitSha?: string;
    fixtureCatalogHash?: string;
  };
};

export async function buildErrorLoopDashboard(cwd: string, options: ErrorLoopDashboardOptions): Promise<ErrorLoopDashboardResult> {
  const inputDir = path.resolve(cwd, options.inputDir);
  const outputDir = path.resolve(cwd, options.outputDir ?? path.join(inputDir, "dashboard"));
  const manifest = await readJson<ErrorLoopManifest>(path.join(inputDir, "manifest.json"));
  const metrics = await readJson<ErrorLoopMetrics>(path.join(inputDir, "metrics.json"));
  const cohorts = await readJson<ErrorLoopCohortMetric[]>(path.join(inputDir, "cohort_metrics.json"));
  const trials = await readJsonl<ErrorLoopTrial>(path.join(inputDir, "trials.jsonl"));
  const summary = buildDashboardSummary(inputDir, outputDir, manifest, metrics, cohorts, trials);
  const html = renderDashboardHtml(manifest, metrics, cohorts, trials, summary);
  const summaryPath = path.join(outputDir, "dashboard_summary.json");
  const htmlPath = path.join(outputDir, "index.html");

  await mkdir(outputDir, { recursive: true });
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(htmlPath, html, "utf8");

  return {
    schemaVersion: "error-loop-dashboard/v1",
    inputDir,
    outputDir,
    htmlPath,
    summaryPath,
    trialCount: trials.length,
    cohortCount: cohorts.length,
    requestedModes: manifest.requestedModes ?? [],
    ablations: manifest.ablations ?? []
  };
}

function buildDashboardSummary(
  inputDir: string,
  outputDir: string,
  manifest: ErrorLoopManifest,
  metrics: ErrorLoopMetrics,
  cohorts: ErrorLoopCohortMetric[],
  trials: ErrorLoopTrial[]
): unknown {
  return {
    schemaVersion: "error-loop-dashboard-summary/v1",
    inputDir,
    outputDir,
    experimentId: manifest.id ?? "unknown",
    createdAt: manifest.createdAt ?? "unknown",
    requestedModes: manifest.requestedModes ?? [],
    ablations: manifest.ablations ?? [],
    memoryPolicy: manifest.memoryPolicy ?? "unknown",
    trials: metrics.trials,
    completed: metrics.completed,
    failures: metrics.failures,
    validationPassRate: metrics.validationPassRate,
    transferTaskPassRate: metrics.transferTaskPassRate,
    recoveryAttemptsMean: metrics.averageRecoveryAttemptsAfterFirstFailure,
    memoryRetrievalPrecision: metrics.memoryRetrievalPrecision,
    cohortCount: cohorts.length,
    trialCount: trials.length,
    bestCohorts: [...cohorts]
      .sort((a, b) => b.validationPassRate - a.validationPassRate || (a.recoveryAttemptsMean ?? Number.POSITIVE_INFINITY) - (b.recoveryAttemptsMean ?? Number.POSITIVE_INFINITY))
      .slice(0, 5)
      .map((cohort) => ({
        key: cohort.key,
        ablation: cohort.ablation,
        taskFamily: cohort.taskFamily,
        taskSplit: cohort.taskSplit,
        validationPassRate: cohort.validationPassRate,
        recoveryAttemptsMean: cohort.recoveryAttemptsMean,
        insufficientData: cohort.insufficientData
      })),
    runtime: manifest.runtime ?? {}
  };
}

function renderDashboardHtml(
  manifest: ErrorLoopManifest,
  metrics: ErrorLoopMetrics,
  cohorts: ErrorLoopCohortMetric[],
  trials: ErrorLoopTrial[],
  summary: unknown
): string {
  const sortedCohorts = [...cohorts].sort((a, b) => a.key.localeCompare(b.key));
  const baselineRows = (manifest.modeSelections ?? [])
    .filter((selection) => selection.baselineMode)
    .map((selection) => `<li><code>${escapeHtml(selection.requestedMode)}</code> -> <code>${escapeHtml(selection.ablation)}</code></li>`)
    .join("") || "<li>none</li>";
  const cohortRows = sortedCohorts.map((cohort) => `<tr>
    <td><code>${escapeHtml(cohort.key)}</code></td>
    <td>${escapeHtml(cohort.ablation)}</td>
    <td>${escapeHtml(cohort.taskFamily)}</td>
    <td>${escapeHtml(cohort.taskSplit)}</td>
    <td>${formatPercent(cohort.validationPassRate)}</td>
    <td>${formatNullable(cohort.recoveryAttemptsMean)}</td>
    <td>${formatNullable(cohort.recoveryAttemptsCi95)}</td>
    <td>${cohort.insufficientData ? "yes" : "no"}</td>
  </tr>`).join("\n");
  const trialRows = trials.map((trial) => `<tr>
    <td>${escapeHtml(trial.trialId)}</td>
    <td>${escapeHtml(trial.requestedMode ?? trial.ablation)}</td>
    <td>${escapeHtml(trial.ablation)}</td>
    <td>${escapeHtml(trial.taskSplit)}</td>
    <td>${escapeHtml(trial.taskFamily)}</td>
    <td>${escapeHtml(trial.result)}</td>
    <td>${trial.validationPassed ? "passed" : trial.validationFailed ? "failed" : "not run"}</td>
    <td>${trial.retrievalSelected}/${trial.retrievalRejected}</td>
  </tr>`).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TomorrowEdge Error-Loop Cohort Dashboard</title>
  <style>
    :root { color-scheme: light; --bg:#f7fafc; --panel:#fff; --line:#dbe6ec; --text:#16212b; --muted:#637282; --accent:#2f6f92; }
    body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
    main { max-width:1180px; margin:0 auto; padding:28px; }
    h1, h2 { margin:0 0 12px; font-family:Inter, ui-sans-serif, system-ui, sans-serif; letter-spacing:0; }
    h1 { font-size:24px; }
    h2 { font-size:16px; margin-top:28px; }
    .grid { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:12px; }
    .card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; }
    .metric { font-size:22px; font-weight:700; }
    .muted { color:var(--muted); }
    table { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--line); }
    th, td { border-bottom:1px solid var(--line); padding:8px 10px; text-align:left; vertical-align:top; }
    th { color:var(--muted); font-weight:600; background:#eef5f8; }
    code { color:#194f6f; }
    pre { white-space:pre-wrap; background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:12px; max-height:320px; overflow:auto; }
  </style>
</head>
<body>
<main>
  <h1>TomorrowEdge Error-Loop Cohort Dashboard</h1>
  <p class="muted">Experiment ${escapeHtml(manifest.id ?? "unknown")} · ${escapeHtml(manifest.createdAt ?? "unknown")}</p>
  <section class="grid">
    <div class="card"><div class="muted">Trials</div><div class="metric">${metrics.trials}</div></div>
    <div class="card"><div class="muted">Completed</div><div class="metric">${metrics.completed}</div></div>
    <div class="card"><div class="muted">Validation pass</div><div class="metric">${formatPercent(metrics.validationPassRate)}</div></div>
    <div class="card"><div class="muted">Transfer pass</div><div class="metric">${formatPercent(metrics.transferTaskPassRate)}</div></div>
  </section>
  <h2>Baseline Modes</h2>
  <ul>${baselineRows}</ul>
  <h2>Cohorts</h2>
  <table>
    <thead><tr><th>Cohort</th><th>Ablation</th><th>Family</th><th>Split</th><th>Pass</th><th>Recovery</th><th>CI95</th><th>Insufficient</th></tr></thead>
    <tbody>${cohortRows}</tbody>
  </table>
  <h2>Trials</h2>
  <table>
    <thead><tr><th>Trial</th><th>Requested mode</th><th>Ablation</th><th>Split</th><th>Family</th><th>Result</th><th>Validation</th><th>Retrieval</th></tr></thead>
    <tbody>${trialRows}</tbody>
  </table>
  <h2>Machine Summary</h2>
  <pre>${escapeHtml(JSON.stringify(summary, null, 2))}</pre>
</main>
</body>
</html>
`;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  const text = await readFile(filePath, "utf8");
  return text.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as T);
}

function formatPercent(value: number | null | undefined): string {
  return typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "-";
}

function formatNullable(value: number | null | undefined): string {
  return typeof value === "number" ? value.toFixed(2) : "-";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}
