import type { AgentRole } from "../../schemas/agentTask.js";

export type ExternalAgentTransport = "mcp";
export type ExternalAgentTrustLevel = "low" | "medium" | "high" | "owner";
export type ExternalAgentAdapter = "generic" | "codex" | "claude_code";
export type ExternalAgentResponseMode = "json" | "json_block" | "text" | "mixed";
export type ExternalAgentWorkingTreeMode = "read_only" | "patch_proposal" | "full_access";
export type ExternalAgentNormalizationStrictness = "off" | "warn" | "strict";

export type ExternalAgentProfile = {
  id: string;
  name: string;
  transport: ExternalAgentTransport;
  adapter?: ExternalAgentAdapter;
  responseMode?: ExternalAgentResponseMode;
  strictJson?: boolean;
  workingTreeMode?: ExternalAgentWorkingTreeMode;
  normalizationStrictness?: ExternalAgentNormalizationStrictness;
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
  adapter?: ExternalAgentAdapter;
  responseMode?: ExternalAgentResponseMode;
  strictJson?: boolean;
  workingTreeMode?: ExternalAgentWorkingTreeMode;
  normalizationStrictness?: ExternalAgentNormalizationStrictness;
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
