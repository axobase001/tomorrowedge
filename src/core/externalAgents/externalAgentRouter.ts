import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import type { RouteAssignment } from "../routing/policies.js";
import { externalAgentRegistryFromConfig } from "./externalAgentRegistry.js";
import type { ExternalAgentProfile } from "./externalAgentTypes.js";

export function isExternalProvider(provider: string): boolean {
  return provider.startsWith("external:");
}

export function externalAgentIdFromProvider(provider: string): string | undefined {
  return isExternalProvider(provider) ? provider.slice("external:".length) : undefined;
}

export function externalAssignmentFor(role: AgentRole, profile: ExternalAgentProfile): RouteAssignment {
  return {
    role,
    provider: `external:${profile.id}`,
    model: profile.name,
    reason: `external MCP agent role binding (${profile.transport}; trust=${profile.trustLevel})`
  };
}

export function validateExternalAssignment(config: TomorrowEdgeConfig, assignment: RouteAssignment): RouteAssignment {
  const externalId = externalAgentIdFromProvider(assignment.provider);
  if (!externalId) return assignment;
  const profile = externalAgentRegistryFromConfig(config).get(externalId);
  if (!profile) {
    return {
      ...assignment,
      reason: `${assignment.reason}; external agent ${externalId} is not enabled in external_agents`
    };
  }
  if (!profile.allowedRoles.includes(assignment.role)) {
    return {
      ...assignment,
      reason: `${assignment.reason}; role ${assignment.role} is outside configured allowedRoles`
    };
  }
  return externalAssignmentFor(assignment.role, profile);
}
