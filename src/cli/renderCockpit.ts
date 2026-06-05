import type { AgentGraphState } from "../core/agentGraph/state.js";
import { renderEventLine } from "../core/events/eventRenderer.js";
import { describeAccessPolicy } from "../core/permissions/accessPolicy.js";

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

export function renderStaticCockpit(graph: AgentGraphState): string {
  const selected = graph.judge?.selectedCandidateId ?? "(none)";
  const recentEvents = [
    ...graph.events.filter((event) => ["shell_run", "repair_attempt", "patch_apply"].includes(event.type)).slice(-6),
    ...graph.events.slice(-8)
  ];
  const uniqueRecentEvents = [...new Map(recentEvents.map((event) => [event.id, event])).values()].map((event) => `- ${renderEventLine(event)}`);
  const target = graph.conversationTarget ? `${graph.conversationTarget.id} (${graph.conversationTarget.label})` : "core (TomorrowEdge Core)";
  const route = graph.routing.assignments
    .filter((assignment) => ["planner", "coder_a", "reviewer", "judge", "runner"].includes(assignment.role))
    .map((assignment) => `${assignment.role}:${assignment.provider}/${assignment.model}`)
    .join(" | ");
  return [
    "TomorrowEdge cockpit summary",
    "",
    "Interactive TUI is unavailable because this terminal does not expose raw input mode.",
    "Run with --headless for JSON, or use a terminal that supports raw mode for the full cockpit.",
    "",
    `Goal: ${graph.goal}`,
    `Target: ${target}`,
    `Access: ${graph.access.mode}`,
    `Access detail: ${describeAccessPolicy(graph.access)}`,
    `Route: ${route || "(none)"}`,
    `Agents: ${graph.agents.length}`,
    `Events: ${graph.events.length}`,
    `Selected patch: ${selected}`,
    `Shell runs: ${graph.runResults.length}`,
    `Result: ${graph.finalSummary?.result ?? "unknown"}`,
    "",
    "Recent events:",
    ...(uniqueRecentEvents.length ? uniqueRecentEvents : ["- none"])
  ].join("\n") + "\n";
}
