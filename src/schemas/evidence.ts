export type RunResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  success: boolean;
};

export type FinalSummary = {
  task: string;
  result: "completed" | "partially_completed" | "failed" | "aborted";
  changedFiles: string[];
  testsRun: string[];
  evidence: string[];
  risksRemaining: string[];
  suggestedCommitMessage: string;
};
