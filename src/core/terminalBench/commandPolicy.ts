import type { TerminalCommandPolicyDecision } from "./types.js";

export type TerminalCommandPolicyOptions = {
  maxCommandChars?: number;
  seenCommands?: ReadonlySet<string>;
};

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(apt-get|apt|apk|dnf|yum|pacman)\s+(install|add|update)\b/i, reason: "package-manager mutation is outside Terminal-Bench execution scope" },
  { pattern: /\b(pip|pip3|npm|pnpm|yarn|bun)\s+install\b/i, reason: "dependency installation is blocked for deterministic benchmark runs" },
  { pattern: /\b(curl|wget|aria2c|ssh|scp|rsync)\b/i, reason: "network or remote access is blocked" },
  { pattern: /\b(sleep|tail\s+-f|watch)\b/i, reason: "long-running command pattern is blocked" },
  { pattern: /\b(while\s+true|for\s+\(\(|python\s+-i|python3\s+-i|node\s+-i|bash\s+-i|sh\s+-i)\b/i, reason: "interactive or unbounded command pattern is blocked" }
];

export function evaluateTerminalCommand(command: string, options: TerminalCommandPolicyOptions = {}): TerminalCommandPolicyDecision {
  const normalizedCommand = command.trim();
  const reasons: string[] = [];
  const maxCommandChars = options.maxCommandChars ?? 1800;
  if (!normalizedCommand) {
    return { allowed: false, severity: "deny", reasons: ["empty command"], normalizedCommand };
  }
  if (normalizedCommand.length > maxCommandChars) {
    reasons.push(`command exceeds ${maxCommandChars} characters; write a file and run it instead`);
  }
  for (const blocked of BLOCKED_PATTERNS) {
    if (blocked.pattern.test(normalizedCommand)) reasons.push(blocked.reason);
  }
  if (reasons.length > 0) {
    return { allowed: false, severity: "deny", reasons, normalizedCommand };
  }
  if (options.seenCommands?.has(normalizedCommand)) {
    return {
      allowed: true,
      severity: "warn",
      reasons: ["repeated command; prefer changing code or verification target if no progress was made"],
      normalizedCommand
    };
  }
  return { allowed: true, severity: "allow", reasons: [], normalizedCommand };
}

export function wrapTerminalCommand(command: string, timeoutSeconds = 25): string {
  return `timeout ${timeoutSeconds}s bash -lc ${shellQuote(command)}`;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
