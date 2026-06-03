import type { AgentGraphState } from "../../core/agentGraph/state.js";

export type TuiViewState = {
  selectedPane: "agents" | "goal" | "router" | "debate" | "diff" | "shell" | "evidence" | "memory" | "help";
  graph: AgentGraphState;
};

export function createInitialViewState(graph: AgentGraphState): TuiViewState {
  return {
    selectedPane: "agents",
    graph
  };
}
