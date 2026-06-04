import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import type { ConversationTarget } from "../../schemas/conversation.js";
import { externalAgentRegistryFromConfig } from "../externalAgents/externalAgentRegistry.js";

const roleTargets: Array<{ role: AgentRole; label: string; description: string }> = [
  { role: "planner", label: "Planner", description: "Ask for decomposition, risk, and implementation strategy only." },
  { role: "reviewer", label: "Reviewer", description: "Ask for critique, missing tests, regression risk, and approval blockers." },
  { role: "judge", label: "Judge", description: "Ask for final selection, revision, or user-decision guidance." },
  { role: "coder_a", label: "Coder", description: "Ask for implementation direction or candidate patch generation." },
  { role: "repairer", label: "Repairer", description: "Ask for post-failure repair strategy." }
];

export function listConversationTargets(config: TomorrowEdgeConfig): ConversationTarget[] {
  const externalTargets = externalAgentRegistryFromConfig(config).list().map((agent) => ({
    id: `agent:${agent.id}`,
    kind: "external_agent" as const,
    label: agent.name,
    description: `Direct message to configured external agent ${agent.id}; allowed roles: ${agent.allowedRoles.join(", ") || "none"}.`,
    externalAgentId: agent.id
  }));
  return [
    {
      id: "core",
      kind: "core",
      label: "TomorrowEdge Core",
      description: "Default target. Core owns orchestration, routing, trace, and final delivery."
    },
    {
      id: "debate",
      kind: "debate",
      label: "Debate Room",
      description: "Broadcast the question into a multi-agent debate context."
    },
    ...roleTargets.map((target) => ({
      id: target.role,
      kind: "role" as const,
      label: target.label,
      description: target.description,
      role: target.role
    })),
    ...externalTargets
  ];
}

export function resolveConversationTarget(config: TomorrowEdgeConfig, rawTarget = "core"): ConversationTarget {
  const normalized = normalizeTarget(rawTarget);
  const targets = listConversationTargets(config);
  const target = targets.find((item) => normalizeTarget(item.id) === normalized || normalizeTarget(item.label) === normalized);
  if (!target) {
    throw new Error(`Unknown conversation target: ${rawTarget}. Run "tedge targets" to list available targets.`);
  }
  return target;
}

export function renderConversationTarget(target: ConversationTarget): string {
  if (target.kind === "external_agent") return `${target.id} (${target.label})`;
  return `${target.id} (${target.label})`;
}

export function targetPromptPrefix(target: ConversationTarget): string {
  if (target.kind === "core") return "User is speaking to TomorrowEdge Core. Core should orchestrate the full workflow.";
  if (target.kind === "debate") return "User is speaking to the Debate Room. Multiple agents should challenge assumptions before execution.";
  if (target.kind === "external_agent") return `User is speaking directly to external agent ${target.externalAgentId}. TomorrowEdge must still record trace and supervision events.`;
  return `User is speaking to the ${target.role} role. Keep the workflow scoped to that role while Core remains responsible for orchestration and trace.`;
}

function normalizeTarget(value: string): string {
  return value.trim().toLowerCase().replace(/^external:/, "agent:");
}
