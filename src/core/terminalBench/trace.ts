import type { TerminalBenchAction, TerminalBenchFilePatch, TerminalBenchTraceEvent, TerminalCommandPolicyDecision, TerminalVerificationResult } from "./types.js";

export function actionTraceEvent(step: number, action: TerminalBenchAction): TerminalBenchTraceEvent {
  return {
    type: "terminal_action",
    step,
    thought: action.thought,
    fileCount: action.files.length,
    commandCount: action.commands.length,
    verify: action.verify,
    done: action.done
  };
}

export function fileUploadTraceEvent(step: number, file: TerminalBenchFilePatch): TerminalBenchTraceEvent {
  return {
    type: "terminal_file_upload",
    step,
    path: file.path,
    bytes: Buffer.byteLength(file.content, file.encoding === "base64" ? "base64" : "utf8")
  };
}

export function commandTraceEvent(step: number, decision: TerminalCommandPolicyDecision): TerminalBenchTraceEvent {
  return {
    type: "terminal_command",
    step,
    command: decision.normalizedCommand,
    allowed: decision.allowed,
    reasons: decision.reasons
  };
}

export function verificationTraceEvent(step: number, result: TerminalVerificationResult): TerminalBenchTraceEvent {
  return {
    type: "terminal_verification",
    step,
    status: result.status,
    hardGatePassed: result.hardGatePassed,
    reasons: result.reasons
  };
}

export function strongInterventionTraceEvent(step: number, model: string, accepted: boolean, reason: string): TerminalBenchTraceEvent {
  return {
    type: "terminal_strong_intervention",
    step,
    model,
    accepted,
    reason
  };
}

export function compactTerminalObservation(label: string, stdout: string, stderr = "", maxChars = 9000): string {
  const rendered = [
    `## ${label}`,
    "# stdout",
    redactBinaryPreview(stdout),
    "# stderr",
    redactBinaryPreview(stderr)
  ].join("\n");
  if (rendered.length <= maxChars) return rendered;
  const head = Math.floor(maxChars * 0.35);
  const tail = maxChars - head - 80;
  return `${rendered.slice(0, head)}\n\n...[omitted ${rendered.length - maxChars} chars]...\n\n${rendered.slice(-tail)}`;
}

function redactBinaryPreview(value: string): string {
  if (!value) return "";
  const suspicious = value.split("").filter((char) => {
    const code = char.charCodeAt(0);
    return code < 9 || (code > 13 && code < 32);
  }).length;
  if (suspicious > Math.max(8, value.length * 0.02)) return "[binary output omitted]";
  return value;
}
