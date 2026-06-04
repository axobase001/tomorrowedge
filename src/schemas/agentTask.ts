export const agentRoles = [
  "core",
  "vision",
  "planner",
  "explorer",
  "coder_a",
  "coder_b",
  "reviewer",
  "judge",
  "runner",
  "repairer",
  "summarizer"
] as const;

export type AgentRole = (typeof agentRoles)[number];

export type AgentStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "blocked"
  | "waiting_for_user";

export type AgentTask = {
  id: string;
  role: AgentRole;
  goal: string;
  input: unknown;
};

export type AgentRunState = {
  id: string;
  role: AgentRole;
  provider: string;
  model: string;
  status: AgentStatus;
  agentKind?: "offline" | "live" | "external";
  startedAt?: string;
  endedAt?: string;
  elapsedMs?: number;
  costUsd?: number;
  summary: string;
};
