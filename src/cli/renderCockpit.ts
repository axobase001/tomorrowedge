import type { AgentGraphState } from "../core/agentGraph/state.js";

export async function renderCockpit(graph: AgentGraphState, safeMode: boolean, cwd: string): Promise<void> {
  if (!canUseRawMode()) {
    process.stdout.write(renderStaticCockpit(graph));
    return;
  }
  const { render } = await import("ink");
  const React = await import("react");
  const { App } = await import("../tui/App.js");
  render(React.createElement(App, { graph, safeMode, cwd }));
}

export function canUseRawMode(): boolean {
  const stdin = process.stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => NodeJS.ReadStream };
  return Boolean(stdin.isTTY && typeof stdin.setRawMode === "function");
}

function renderStaticCockpit(graph: AgentGraphState): string {
  const selected = graph.judge?.selectedCandidateId ?? "(none)";
  return [
    "TomorrowEdge cockpit summary",
    "",
    "Interactive TUI is unavailable because this terminal does not expose raw input mode.",
    "Run with --headless for JSON, or use a terminal that supports raw mode for the full cockpit.",
    "",
    `Goal: ${graph.goal}`,
    `Access: ${graph.access.mode}`,
    `Agents: ${graph.agents.length}`,
    `Events: ${graph.events.length}`,
    `Selected patch: ${selected}`,
    `Shell runs: ${graph.runResults.length}`,
    `Result: ${graph.finalSummary?.result ?? "unknown"}`
  ].join("\n") + "\n";
}
