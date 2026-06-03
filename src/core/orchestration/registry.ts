import type { TomorrowEdgeConfig } from "../../config/schema.js";
import { AutoGenBackend, CrewAIBackend, LangGraphBackend } from "./placeholderBackends.js";
import { NativeBackend } from "./nativeBackend.js";
import type { OrchestrationBackend, OrchestrationBackendId } from "./backend.js";

export function createOrchestrationBackend(config: TomorrowEdgeConfig): OrchestrationBackend {
  const backend = backendFor(config.orchestration.backend);
  backend.load(config);
  return backend;
}

export function backendFor(id: OrchestrationBackendId): OrchestrationBackend {
  if (id === "native") return new NativeBackend();
  if (id === "langgraph") return new LangGraphBackend();
  if (id === "crewai") return new CrewAIBackend();
  return new AutoGenBackend();
}

