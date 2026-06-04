import type { AgentRole } from "../../schemas/agentTask.js";

export type ExternalAgentTransport = "mcp";
export type ExternalAgentTrustLevel = "low" | "medium" | "high" | "owner";

export type ExternalAgentProfile = {
  id: string;
  name: string;
  transport: ExternalAgentTransport;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  proxyPort?: number;
  autoStart?: boolean;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxRetries?: number;
  capabilities: string[];
  allowedRoles: AgentRole[];
  trustLevel: ExternalAgentTrustLevel;
  costProfile?: Record<string, unknown>;
  notes?: string;
};

export type ExternalAgentRegistrationInput = {
  id: string;
  name?: string;
  transport?: ExternalAgentTransport;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  proxyPort?: number;
  autoStart?: boolean;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxRetries?: number;
  capabilities?: string[];
  allowedRoles?: AgentRole[];
  trustLevel?: ExternalAgentTrustLevel;
  costProfile?: Record<string, unknown>;
  notes?: string;
};
