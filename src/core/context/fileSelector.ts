export type ContextSelection = {
  selectedFiles: Array<{
    path: string;
    reason: string;
    risk: "safe" | "sensitive" | "large" | "binary" | "ignored";
  }>;
  excludedFiles: Array<{
    path: string;
    reason: string;
  }>;
  grepQueriesUsed: string[];
  contextSummary: string;
};
