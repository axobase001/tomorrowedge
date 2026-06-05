import type { AgentRole } from "../../schemas/agentTask.js";

export type BudgetLedgerEntry = {
  role: AgentRole;
  provider: string;
  model: string;
  estimatedCostUsd?: number;
  strongAgentCall: boolean;
};

export function summarizeBudgetLedger(entries: BudgetLedgerEntry[]): { strongAgentCalls: number; estimatedCostUsd?: number } {
  const estimated = entries.reduce((sum, entry) => sum + (entry.estimatedCostUsd ?? 0), 0);
  return {
    strongAgentCalls: entries.filter((entry) => entry.strongAgentCall).length,
    estimatedCostUsd: estimated || undefined
  };
}
