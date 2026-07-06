export type RunResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  success: boolean;
  timedOut?: boolean;
  skipped?: boolean;
  skipReason?: string;
};

export type FinalSummary = {
  task: string;
  result: "completed" | "partially_completed" | "failed" | "aborted";
  userReply?: string;
  userReplySource?: "model" | "system" | "blocked";
  changedFiles: string[];
  testsRun: string[];
  evidence: string[];
  risksRemaining: string[];
  suggestedCommitMessage: string;
  statusBreakdown?: WorkflowStatusBreakdown;
};

export type WorkflowStatusBreakdown = {
  providerSmoke: "not_recorded" | "passed" | "failed";
  modelInvocation: "not_run" | "attempted" | "blocked";
  scheduler: "not_run" | "completed" | "blocked";
  patchApplication: "not_generated" | "generated" | "applied" | "blocked" | "invalid";
  syntaxValidation: "not_run" | "passed" | "failed";
  artifactQuality: "not_run" | "passed" | "failed";
  externalTests: "not_run" | "passed" | "failed" | "skipped";
  reviewQuality: "full" | "degraded" | "incomplete" | "not_required";
  taskAcceptance: "accepted" | "rejected" | "incomplete";
  reasons: string[];
};
