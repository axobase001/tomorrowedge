import path from "node:path";
import { listSessions, loadLatestSession, loadSession, type SessionRecord } from "../../core/memory/sessionMemory.js";
import type { FinalSummary } from "../../schemas/evidence.js";
import { renderCockpit } from "../renderCockpit.js";

type SessionInspectSummary = {
  schemaVersion: "tomorrowedge-session-inspect/v1";
  sessionId: string;
  createdAt: string;
  goal: string;
  result: string;
  workflowKind: string;
  accessMode: string;
  eventCount: number;
  artifactCount: number;
  changedFiles: string[];
  testsRun: string[];
  traceCompletenessScore?: number;
  finalSummary?: FinalSummary;
};

export async function replayCommand(cwd: string, sessionId: string): Promise<void> {
  const session = sessionId === "latest" ? await loadLatestSession(cwd) : await loadSession(cwd, sessionId);
  await renderCockpit(session.state, true, cwd);
}

export async function sessionsInspectCommand(cwd: string, sessionId = "latest", options: { json?: boolean; cwd?: string } = {}): Promise<void> {
  const targetCwd = options.cwd ? path.resolve(cwd, options.cwd) : cwd;
  const session = sessionId === "latest" ? await loadLatestSession(targetCwd) : await loadSession(targetCwd, sessionId);
  const summary = sessionInspectSummary(session);
  if (options.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    return;
  }
  process.stdout.write([
    `Session: ${summary.sessionId}`,
    `Created: ${summary.createdAt}`,
    `Goal: ${summary.goal || "(empty)"}`,
    `Result: ${summary.result}`,
    `Workflow: ${summary.workflowKind}`,
    `Access: ${summary.accessMode}`,
    `Events: ${summary.eventCount}`,
    `Artifacts: ${summary.artifactCount}`,
    `Changed files: ${summary.changedFiles.length ? summary.changedFiles.join(", ") : "none"}`,
    `Tests: ${summary.testsRun.length ? summary.testsRun.join(", ") : "none"}`,
    ""
  ].join("\n"));
}

export async function sessionsCommand(cwd: string): Promise<void> {
  const sessions = await listSessions(cwd);
  if (!sessions.length) {
    process.stdout.write("No sessions found.\n");
    return;
  }
  for (const session of sessions) {
    process.stdout.write(`${session.sessionId}\t${session.createdAt}\t${session.state.finalSummary?.result ?? "unknown"}\t${session.state.goal}\n`);
  }
}

function sessionInspectSummary(session: SessionRecord): SessionInspectSummary {
  const state = session.state;
  return {
    schemaVersion: "tomorrowedge-session-inspect/v1",
    sessionId: session.sessionId,
    createdAt: session.createdAt,
    goal: state.goal,
    result: state.finalSummary?.result ?? "unknown",
    workflowKind: state.workflowKind ?? "unknown",
    accessMode: state.access?.mode ?? "unknown",
    eventCount: session.eventCount ?? state.events.length,
    artifactCount: session.artifactCount ?? state.eventArtifacts.length,
    changedFiles: state.finalSummary?.changedFiles ?? state.changedFiles ?? [],
    testsRun: state.finalSummary?.testsRun ?? state.runResults?.map((result) => result.command) ?? [],
    traceCompletenessScore: state.traceCompleteness?.score,
    finalSummary: state.finalSummary
  };
}
