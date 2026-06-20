export type TerminalBenchFilePatch = {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
};

export type TerminalBenchAction = {
  thought: string;
  files: TerminalBenchFilePatch[];
  commands: string[];
  verify: boolean;
  done: boolean;
};

export type TerminalBenchActionParseResult =
  | { ok: true; action: TerminalBenchAction; warnings: string[] }
  | { ok: false; error: string; rawExcerpt: string };

export type TerminalCommandPolicyDecision = {
  allowed: boolean;
  severity: "allow" | "warn" | "deny";
  reasons: string[];
  normalizedCommand: string;
};

export type TerminalVerificationStatus =
  | "pass"
  | "no_file"
  | "size_fail"
  | "crash"
  | "output_mismatch"
  | "timeout"
  | "fail"
  | "unknown";

export type TerminalVerificationResult = {
  status: TerminalVerificationStatus;
  hardGatePassed: boolean;
  reasons: string[];
  sizeBytes?: number;
  decompExitCode?: number;
  outputSizeBytes?: number;
};

export type TerminalBenchTraceEvent =
  | {
      type: "terminal_action";
      step: number;
      thought: string;
      fileCount: number;
      commandCount: number;
      verify: boolean;
      done: boolean;
    }
  | {
      type: "terminal_file_upload";
      step: number;
      path: string;
      bytes: number;
    }
  | {
      type: "terminal_command";
      step: number;
      command: string;
      allowed: boolean;
      reasons: string[];
    }
  | {
      type: "terminal_verification";
      step: number;
      status: TerminalVerificationStatus;
      hardGatePassed: boolean;
      reasons: string[];
    }
  | {
      type: "terminal_escalation";
      step: number;
      reason: string;
      failureCount: number;
    }
  | {
      type: "terminal_strong_intervention";
      step: number;
      model: string;
      accepted: boolean;
      reason: string;
    };

export type TerminalEscalationInput = {
  step: number;
  maxSteps: number;
  consecutiveHardGateFailures: number;
  lastStatus?: TerminalVerificationStatus;
  strongAgentAvailable?: boolean;
};

export type TerminalEscalationDecision = {
  shouldEscalate: boolean;
  reason?: string;
};
