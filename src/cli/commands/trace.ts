import { loadLatestSession, loadSession } from "../../core/memory/sessionMemory.js";
import { renderEventLine } from "../../core/events/eventRenderer.js";

export async function traceCommand(cwd: string, sessionId: string): Promise<void> {
  const initial = sessionId === "latest" ? await loadLatestSession(cwd) : await loadSession(cwd, sessionId);
  const session = await loadSession(cwd, initial.sessionId);
  if (!session.state.events.length) {
    process.stdout.write("No events recorded for this session.\n");
    return;
  }
  for (const event of session.state.events) {
    process.stdout.write(`${renderEventLine(event)}\n`);
  }
}
