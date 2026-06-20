import type { TerminalEscalationDecision, TerminalEscalationInput } from "./types.js";

export function shouldEscalateTerminalBench(input: TerminalEscalationInput): TerminalEscalationDecision {
  if (!input.strongAgentAvailable) return { shouldEscalate: false };
  if (input.consecutiveHardGateFailures >= 3) {
    return {
      shouldEscalate: true,
      reason: `hard gate failed ${input.consecutiveHardGateFailures} consecutive times (${input.lastStatus ?? "unknown"})`
    };
  }
  if (input.step >= Math.max(2, input.maxSteps - 2) && input.lastStatus && input.lastStatus !== "pass") {
    return {
      shouldEscalate: true,
      reason: `near step budget with unresolved verification status ${input.lastStatus}`
    };
  }
  return { shouldEscalate: false };
}
