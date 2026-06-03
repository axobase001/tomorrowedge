import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { TomorrowEdgeEvent } from "../events/eventTypes.js";
import type { OfflineGraphOptions } from "../agentGraph/executor.js";

export type OrchestrationBackendId = "native" | "langgraph" | "crewai" | "autogen";

export type OrchestrationRunInput = {
  cwd: string;
  goal: string;
  options?: OfflineGraphOptions;
};

export interface OrchestrationBackend {
  id: OrchestrationBackendId;
  name: string;
  load(config: TomorrowEdgeConfig): Promise<void> | void;
  run(input: OrchestrationRunInput): AsyncIterable<TomorrowEdgeEvent>;
}

export class OrchestrationBackendUnavailableError extends Error {
  constructor(backendId: string, reason: string) {
    super(
      `Orchestration backend "${backendId}" is not executable in this build: ${reason}. ` +
        "Use orchestration.backend: native, or implement the adapter before selecting this backend."
    );
    this.name = "OrchestrationBackendUnavailableError";
  }
}

