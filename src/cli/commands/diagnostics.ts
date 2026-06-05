import { loadLatestSession, loadSession } from "../../core/memory/sessionMemory.js";
import { computeTraceCompleteness } from "../../core/diagnostics/traceCompleteness.js";
import type { TomorrowEdgeEvent } from "../../core/events/eventTypes.js";

export async function diagnosticsCommand(cwd: string, action = "latest"): Promise<void> {
  if (action === "on") {
    process.stdout.write("Diagnostics are recorded automatically in TomorrowEdge event ledgers.\n");
    return;
  }
  const session = action === "latest" ? await loadLatestSession(cwd) : await loadSession(cwd, action);
  process.stdout.write(renderDiagnostics(session.state.events));
}

export function renderDiagnostics(events: TomorrowEdgeEvent[]): string {
  const completeness = computeTraceCompleteness(events);
  const count = (type: TomorrowEdgeEvent["type"]) => events.filter((event) => event.type === type).length;
  const fallbacks = events.filter((event) => event.type === "fallback_to_native" || event.type === "provider_fallback");
  const routing = events.filter((event) => event.type === "routing_decision");
  const projections = events.filter((event) => event.type === "artifact_projection");
  const budget = events.filter((event) => event.type === "budget_decision" || event.type === "cost_usage");
  const stop = [...events].reverse().find((event) => event.type === "workflow_stop_reason");
  return [
    "Trace Diagnostics",
    "=================",
    `routing decisions: ${routing.length}`,
    `fallbacks: ${fallbacks.length}`,
    `external calls: ${count("external_agent_call")}`,
    `artifact projections: ${projections.length}`,
    `evidence packets: ${count("evidence_packet")}`,
    `budget events: ${budget.length}`,
    `repair attempts: ${count("repair_attempt")}`,
    `shell runs: ${count("shell_run")}`,
    `trace completeness: ${completeness.score}`,
    completeness.missing.length ? `missing: ${completeness.missing.join(", ")}` : "missing: none",
    stop && "reason" in stop ? `stop reason: ${stop.reason}` : "stop reason: not recorded",
    ""
  ].join("\n");
}
