import type { AgentRole } from "../../../schemas/agentTask.js";
import type { EventLedger } from "../../events/eventLedger.js";
import type { ExternalAgentProfile } from "../externalAgentTypes.js";

export type ExternalAgentRunnerInput = {
  cwd: string;
  profile: ExternalAgentProfile;
  role: AgentRole;
  task: string;
  context?: unknown;
  ledger?: EventLedger;
  timeoutMs?: number;
};

export type ExternalAgentRunnerResult = {
  ok: boolean;
  externalAgentId: string;
  role: AgentRole;
  stdout: string;
  stderr: string;
  summary: string;
  exitCode?: number;
  durationMs: number;
  requestRef?: string;
  responseRef?: string;
  resultRef?: string;
  error?: string;
};
