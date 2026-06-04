import type { AgentRole } from "./agentTask.js";

export type ConversationTargetKind = "core" | "role" | "debate" | "external_agent";

export type ConversationTarget = {
  id: string;
  kind: ConversationTargetKind;
  label: string;
  description: string;
  role?: AgentRole;
  externalAgentId?: string;
};
