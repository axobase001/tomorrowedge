export type RunResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  success: boolean;
  skipped?: boolean;
  skipReason?: string;
};

export type FinalSummary = {
  task: string;
  result: "completed" | "partially_completed" | "failed" | "aborted";
  userReply?: string;
  userReplySource?: "model" | "local" | "handoff";
  changedFiles: string[];
  testsRun: string[];
  evidence: string[];
  risksRemaining: string[];
  suggestedCommitMessage: string;
};
