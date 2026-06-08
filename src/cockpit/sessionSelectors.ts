import path from "node:path";
import type { AgentGraphState } from "../core/agentGraph/state.js";
import type { TomorrowEdgeEvent } from "../core/events/eventTypes.js";
import type { CockpitWorkflowStage } from "./contracts.js";

export function sessionTitle(state?: Pick<AgentGraphState, "goal" | "sessionId">): string {
  if (!state?.goal) return "New task";
  return state.goal.length > 42 ? `${state.goal.slice(0, 39)}...` : state.goal;
}
export function workspaceLabel(cwd: string): string {
  const base = path.basename(cwd);
  return base || cwd;
}

export function inferWorkflowStage(state?: AgentGraphState): CockpitWorkflowStage {
  if (!state) return "idle";
  const events = state.events ?? [];
  if (state.finalSummary?.result === "failed") return "failed";
  if (state.finalSummary?.result === "aborted") return "failed";
  if (state.agents.some((agent) => agent.status === "waiting_for_user")) return "waiting_approval";
  if (state.finalSummary) return "done";
  if (events.some((event) => event.type === "shell_run")) return latestShellFailed(events) ? "failed" : "testing";
  if (state.judge) return state.judge.decision === "ask_user" ? "waiting_approval" : "reviewing";
  if (state.review) return "reviewing";
  if (state.candidates.length || state.repairCandidates.length) return "editing";
  if (state.contextSelection) return "editing";
  if (state.plan) return "routing";
  return "planning";
}

export function eventSummary(event: TomorrowEdgeEvent): string {
  if ("summary" in event && typeof event.summary === "string") return event.summary;
  if ("reason" in event && typeof event.reason === "string") return event.reason;
  if ("command" in event && typeof event.command === "string") return event.command;
  if ("recommendation" in event && typeof event.recommendation === "string") return event.recommendation;
  if ("decision" in event && typeof event.decision === "string") return event.decision;
  if ("status" in event && typeof event.status === "string") return event.status;
  if ("role" in event && typeof event.role === "string") return event.role;
  return event.type;
}

export function latestShellFailed(events: TomorrowEdgeEvent[]): boolean {
  const latest = [...events].reverse().find((event) => event.type === "shell_run");
  return latest?.type === "shell_run" && latest.success === false;
}
