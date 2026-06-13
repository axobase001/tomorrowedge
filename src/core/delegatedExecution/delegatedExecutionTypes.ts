export type CostUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
};

export type DelegatedTaskResult = {
  taskNodeId: string;
  ownerAgentId: string;
  provider: string;
  model?: string;
  status: "success" | "failed" | "blocked" | "skipped";
  evidenceRefs: string[];
  artifactRefs: string[];
  costUsage?: CostUsage;
  failureSignals?: string[];
  summary: string;
};
