import { loadLatestSession, loadSession } from "../../core/memory/sessionMemory.js";
import { renderEventLine, renderVerboseEventLine } from "../../core/events/eventRenderer.js";
import { renderDiagnostics } from "./diagnostics.js";
import path from "node:path";

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
