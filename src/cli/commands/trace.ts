import { loadLatestSession, loadSession } from "../../core/memory/sessionMemory.js";
import { renderEventLine, renderVerboseEventLine } from "../../core/events/eventRenderer.js";
import { renderDiagnostics } from "./diagnostics.js";
import path from "node:path";
import { readTraces } from "../../core/traces/traceStore.js";
import type { ScenarioType } from "../../core/scenarios/scenarioTypes.js";

export type TraceOptions = {
  verbose?: boolean;
  diagnostics?: boolean;
  cwd?: string;
};

export async function traceCommand(cwd: string, sessionId: string, options: TraceOptions = {}): Promise<void> {
  const targetCwd = options.cwd ? path.resolve(cwd, options.cwd) : cwd;
  const session = sessionId === "latest" ? await loadLatestSession(targetCwd) : await loadSession(targetCwd, sessionId);
  if (!session.state.events.length) {
    process.stdout.write("No events recorded for this session.\n");
    return;
  }
  for (const event of session.state.events) {
    process.stdout.write(`${options.verbose ? renderVerboseEventLine(event) : renderEventLine(event)}\n`);
  }
  if (options.diagnostics) {
    process.stdout.write(`\n${renderDiagnostics(session.state.events)}`);
  }
}

export async function traceInspectCommand(cwd: string, sessionId = "latest", options: { json?: boolean; cwd?: string } = {}): Promise<void> {
  const targetCwd = options.cwd ? path.resolve(cwd, options.cwd) : cwd;
  const session = sessionId === "latest" ? await loadLatestSession(targetCwd).catch(() => undefined) : await loadSession(targetCwd, sessionId).catch(() => undefined);
  const trace = session?.state.objectiveTrace ?? (await readTraces(targetCwd, { limit: 200, newestFirst: true })).find((item) => item.traceId === sessionId || item.runId === sessionId);
  if (!trace) {
    process.stdout.write("No objective-action-feedback trace found.\n");
    return;
  }
  if (options.json) {
    process.stdout.write(JSON.stringify(trace, null, 2) + "\n");
    return;
  }
  process.stdout.write([
    `Objective Trace ${trace.traceId}`,
    `Run: ${trace.runId}`,
    `Scenario: ${trace.scenarioProfile.scenarioType}`,
    `Workflow: ${trace.planSummary.workflowKind}`,
    `Outcome: ${trace.outcome.finalStatus}`,
    `Evidence score: ${trace.evidenceSummary.evidenceScore}`,
    `Shell runs: ${trace.executionSummary.shellRuns}`,
    `Cost: ${trace.costSummary.estimatedCostUsd === undefined ? "unknown" : `$${trace.costSummary.estimatedCostUsd.toFixed(6)}`}`,
    "",
    "Lessons:",
    ...(trace.outcome.lessons.length ? trace.outcome.lessons.map((item) => `- ${item}`) : ["- none"]),
    "",
    "Missing evidence:",
    ...(trace.evidenceSummary.missingEvidence.length ? trace.evidenceSummary.missingEvidence.map((item) => `- ${item}`) : ["- none"]),
    ""
  ].join("\n"));
}

export async function traceListCommand(cwd: string, options: { scenario?: string; limit?: string; json?: boolean } = {}): Promise<void> {
  const limit = Number.parseInt(options.limit ?? "20", 10);
  const scenarioType = parseScenarioType(options.scenario);
  const traces = await readTraces(cwd, { limit: Number.isFinite(limit) ? limit : 20, newestFirst: true, scenarioType });
  if (options.json) {
    process.stdout.write(JSON.stringify(traces, null, 2) + "\n");
    return;
  }
  if (!traces.length) {
    process.stdout.write("No objective traces found.\n");
    return;
  }
  for (const trace of traces) {
    process.stdout.write(`${trace.traceId}\t${trace.createdAt}\t${trace.scenarioProfile.scenarioType}\t${trace.planSummary.workflowKind}\t${trace.outcome.finalStatus}\t${trace.goal}\n`);
  }
}

function parseScenarioType(value?: string): ScenarioType | undefined {
  if (!value) return undefined;
  return ["coding", "research", "document", "debugging", "refactor", "analysis", "planning", "ops", "unknown"].includes(value) ? value as ScenarioType : undefined;
}
