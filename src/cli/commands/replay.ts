import { listSessions, loadLatestSession, loadSession } from "../../core/memory/sessionMemory.js";

export async function replayCommand(cwd: string, sessionId: string): Promise<void> {
  const session = sessionId === "latest" ? await loadLatestSession(cwd) : await loadSession(cwd, sessionId);
  const { render } = await import("ink");
  const React = await import("react");
  const { App } = await import("../../tui/App.js");
  render(React.createElement(App, { graph: session.state, safeMode: true, cwd }));
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
