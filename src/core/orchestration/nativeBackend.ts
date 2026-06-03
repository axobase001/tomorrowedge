import type { TomorrowEdgeConfig } from "../../config/schema.js";
import { runOfflineGraph, type OfflineGraphOptions } from "../agentGraph/executor.js";
import type { AgentGraphState } from "../agentGraph/state.js";
import type { TomorrowEdgeEvent } from "../events/eventTypes.js";
import type { OrchestrationBackend, OrchestrationRunInput } from "./backend.js";

export class NativeBackend implements OrchestrationBackend {
  readonly id = "native" as const;
  readonly name = "TomorrowEdge Native Agent Graph";

  private config?: TomorrowEdgeConfig;
  private lastState?: AgentGraphState;

  load(config: TomorrowEdgeConfig): void {
    this.config = config;
  }

  async *run(input: OrchestrationRunInput): AsyncIterable<TomorrowEdgeEvent> {
    const state = await this.runGraph(input.cwd, input.goal, input.options);
    for (const event of state.events) {
      yield event;
    }
  }

  async runGraph(cwd: string, goal: string, options: OfflineGraphOptions = {}): Promise<AgentGraphState> {
    if (!this.config) {
      throw new Error("NativeBackend.load(config) must be called before runGraph().");
    }
    this.lastState = await runOfflineGraph(cwd, goal, this.config, options);
    return this.lastState;
  }

  getLastState(): AgentGraphState | undefined {
    return this.lastState;
  }
}

