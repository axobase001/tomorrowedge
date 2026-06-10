import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import type { ExternalAgentProfile, ExternalAgentRegistrationInput } from "./externalAgentTypes.js";

export class ExternalAgentRegistry {
  private readonly profiles = new Map<string, ExternalAgentProfile>();

  constructor(initialProfiles: ExternalAgentProfile[] = []) {
    for (const profile of initialProfiles) this.register(profile);
  }

  register(input: ExternalAgentProfile | ExternalAgentRegistrationInput): ExternalAgentProfile {
    const profile = normalizeProfile(input);
    this.profiles.set(profile.id, profile);
    return profile;
  }

  get(id: string): ExternalAgentProfile | undefined {
    return this.profiles.get(id);
  }

  list(): ExternalAgentProfile[] {
    return [...this.profiles.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  findForRole(role: AgentRole): ExternalAgentProfile[] {
    return this.list().filter((profile) => profile.allowedRoles.includes(role));
  }
}

export function externalAgentRegistryFromConfig(config: TomorrowEdgeConfig): ExternalAgentRegistry {
  const registry = new ExternalAgentRegistry();
  for (const [id, item] of Object.entries(config.external_agents ?? {})) {
    if (!item.enabled) continue;
    registry.register({
      id,
      name: item.name ?? id,
      transport: item.transport,
      adapter: item.adapter,
      responseMode: item.responseMode,
      strictJson: item.strictJson,
      workingTreeMode: item.workingTreeMode,
      normalizationStrictness: item.normalizationStrictness,
      command: item.command,
      args: item.args,
      cwd: item.cwd,
      env: item.env,
      proxyPort: item.proxyPort,
      autoStart: item.autoStart,
      startupTimeoutMs: item.startupTimeoutMs,
      requestTimeoutMs: item.requestTimeoutMs,
      maxRetries: item.maxRetries,
      capabilities: item.capabilities,
      allowedRoles: item.roles,
      trustLevel: item.trustLevel,
      costProfile: item.costProfile,
      notes: item.notes
    });
  }
  return registry;
}

function normalizeProfile(input: ExternalAgentProfile | ExternalAgentRegistrationInput): ExternalAgentProfile {
  return {
    id: input.id,
    name: input.name ?? input.id,
    transport: input.transport ?? "mcp",
    adapter: input.adapter,
    responseMode: input.responseMode ?? "mixed",
    strictJson: input.strictJson ?? false,
    workingTreeMode: input.workingTreeMode ?? "patch_proposal",
    normalizationStrictness: input.normalizationStrictness ?? "warn",
    command: input.command,
    args: input.args ?? [],
    cwd: input.cwd,
    env: input.env ?? {},
    proxyPort: input.proxyPort,
    autoStart: input.autoStart ?? false,
    startupTimeoutMs: input.startupTimeoutMs ?? 10_000,
    requestTimeoutMs: input.requestTimeoutMs ?? 60_000,
    maxRetries: input.maxRetries ?? 1,
    capabilities: input.capabilities ?? [],
    allowedRoles: input.allowedRoles ?? [],
    trustLevel: input.trustLevel ?? "medium",
    costProfile: input.costProfile,
    notes: input.notes
  };
}
