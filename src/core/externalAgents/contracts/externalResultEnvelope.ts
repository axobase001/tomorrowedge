import type { AgentRole } from "../../../schemas/agentTask.js";

export type ExternalResultEnvelope = {
  role: AgentRole;
  status: "success" | "failed" | "partial";
  summary: string;
  payload: unknown;
  artifacts?: string[];
  confidence?: number;
};
