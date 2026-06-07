import type { AgentGraphState } from "../core/agentGraph/state.js";
import type { CockpitCapabilitySummary } from "./contracts.js";

type CapabilityDefinition = Omit<CockpitCapabilitySummary, "readiness">;

const capabilityDefinitions: CapabilityDefinition[] = [
  {
    id: "workflow-ledger",
    label: "Workflow event ledger",
    status: "available",
    category: "workflow",
    summary: "Plan, route, patch, review, judge, shell, repair, and summary events are recorded.",
    refs: ["src/core/events/eventTypes.ts", "src/core/memory/sessionMemory.ts"]
  },
  {
    id: "provider-routing",
    label: "Provider routing and model availability",
    status: "available",
    category: "provider",
    summary: "Role assignments expose provider/model choices and routing reasons.",
    refs: ["src/core/routing/policies.ts", "src/cockpit/viewModel.ts"]
  },
  {
    id: "evidence-budget-telemetry",
    label: "Evidence, budget, and cost telemetry",
    status: "experimental",
    category: "evidence",
    summary: "Evidence packets, usage summaries, budget state, and cost events are projected into the cockpit.",
    refs: ["src/core/evidence/evidencePacket.ts", "src/core/budget/budgetLedger.ts"]
  },
  {
    id: "mcp-external-agents",
    label: "MCP and external agent readiness",
    status: "experimental",
    category: "external",
    summary: "External agents can register, submit typed role outputs, and appear in the trace.",
    refs: ["src/mcp/server.ts", "src/core/externalAgents/externalAgentRegistry.ts"]
  },
  {
    id: "orchestration-adapters",
    label: "Third-party orchestration adapters",
    status: "scaffold",
    category: "workflow",
    summary: "Native backend is real; LangGraph, CrewAI, AutoGen, and MCP tool adapters are placeholders.",
    refs: ["docs/ORCHESTRATION_BACKENDS.md", "src/core/orchestration"]
  },
  {
    id: "gui-client",
    label: "Local GUI client",
    status: "experimental",
    category: "gui",
    summary: "React cockpit serves live sessions, approvals, telemetry, drawer details, and runtime screenshots.",
    refs: ["src/cockpit-web", "src/localCockpit/server.ts"]
  }
];

export function buildCapabilityDashboard(state?: AgentGraphState): CockpitCapabilitySummary[] {
  return capabilityDefinitions.map((definition) => ({
    ...definition,
    readiness: readinessFor(definition.id, state)
  }));
}

function readinessFor(id: string, state?: AgentGraphState): string {
  if (!state) return "No session loaded yet.";
  if (id === "workflow-ledger") return `${state.events.length} event(s), ${state.eventArtifacts.length} artifact(s).`;
  if (id === "provider-routing") {
    const providers = [...new Set(state.routing.assignments.map((assignment) => assignment.provider))];
    return providers.length ? `${providers.length} provider(s): ${providers.join(", ")}.` : "No role assignments recorded yet.";
  }
  if (id === "evidence-budget-telemetry") {
    const cost = typeof state.usageSummary.estimatedCostUsd === "number" ? `$${state.usageSummary.estimatedCostUsd.toFixed(4)}` : "not measured";
    return `${state.evidencePackets.length} evidence packet(s), ${state.budgetStatuses.length} budget decision(s), cost ${cost}.`;
  }
  if (id === "mcp-external-agents") {
    const externalEvents = state.events.filter((event) => event.type.startsWith("external_agent_"));
    const externalAgents = state.agents.filter((agent) => agent.agentKind === "external");
    return `${externalAgents.length} external agent run(s), ${externalEvents.length} external event(s).`;
  }
  if (id === "orchestration-adapters") return "Native backend active; third-party adapters remain explicit placeholders.";
  if (id === "gui-client") return state.sessionId ? `Session ${state.sessionId} projected into shared ViewModel.` : "Ready.";
  return "Readiness not measured.";
}
