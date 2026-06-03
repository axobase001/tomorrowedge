import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { TomorrowEdgeEvent } from "../events/eventTypes.js";
import type { OrchestrationBackend, OrchestrationBackendId, OrchestrationRunInput } from "./backend.js";
import { OrchestrationBackendUnavailableError } from "./backend.js";

export abstract class PlaceholderBackend implements OrchestrationBackend {
  abstract readonly id: OrchestrationBackendId;
  abstract readonly name: string;
  protected config?: TomorrowEdgeConfig;

  load(config: TomorrowEdgeConfig): void {
    this.config = config;
  }

  async *run(_input: OrchestrationRunInput): AsyncIterable<TomorrowEdgeEvent> {
    throw new OrchestrationBackendUnavailableError(
      this.id,
      "the adapter is registered for configuration, docs, and architecture planning, but third-party framework execution is intentionally not wired yet"
    );
  }
}

export class LangGraphBackend extends PlaceholderBackend {
  readonly id = "langgraph" as const;
  readonly name = "LangGraph Adapter Placeholder";
}

export class CrewAIBackend extends PlaceholderBackend {
  readonly id = "crewai" as const;
  readonly name = "CrewAI Adapter Placeholder";
}

export class AutoGenBackend extends PlaceholderBackend {
  readonly id = "autogen" as const;
  readonly name = "AutoGen Adapter Placeholder";
}

export class MCPToolAdapter {
  readonly name = "MCP Tool Adapter Placeholder";

  load(_config: TomorrowEdgeConfig): void {
    // MCP tool bridging is configured under orchestration.mcp_tools.
  }

  async *run(_input: OrchestrationRunInput): AsyncIterable<TomorrowEdgeEvent> {
    throw new OrchestrationBackendUnavailableError(
      "mcp_tool",
      "MCP tool adapters are planned as tool/plugin bridges under the selected orchestration backend, not as a top-level backend"
    );
  }
}
