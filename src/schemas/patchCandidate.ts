export type PatchCandidate = {
  candidateId: string;
  agentId: string;
  approach: "minimal_patch" | "refactor" | "test_first" | "alternative" | "repair";
  summary: string;
  filesChanged: string[];
  unifiedDiff: string;
  testPlan: string[];
  knownTradeoffs: string[];
  estimatedRisk: "low" | "medium" | "high";
};
