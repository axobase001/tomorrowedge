import { listSessions, loadLatestSession, loadSession } from "../../core/memory/sessionMemory.js";
import { renderCockpit } from "../renderCockpit.js";

export async function replayCommand(cwd: string, sessionId: string): Promise<void> {
  const initial = sessionId === "latest" ? await loadLatestSession(cwd) : await loadSession(cwd, sessionId);
  const session = await loadSession(cwd, initial.sessionId);
  await renderCockpit(session.state, true, cwd);
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
