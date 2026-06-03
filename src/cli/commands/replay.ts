import { listSessions, loadLatestSession, loadSession } from "../../core/memory/sessionMemory.js";
import { renderInteractiveApp } from "../../tui/renderApp.js";

export async function replayCommand(cwd: string, sessionId: string): Promise<void> {
  const session = sessionId === "latest" ? await loadLatestSession(cwd) : await loadSession(cwd, sessionId);
  await renderInteractiveApp({ graph: session.state, safeMode: true, cwd, commandName: "tedge replay" });
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
