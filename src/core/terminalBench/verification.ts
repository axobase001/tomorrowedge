import type { TerminalVerificationResult, TerminalVerificationStatus } from "./types.js";

export function terminalBenchVerificationCommand(): string {
  return [
    "if [ ! -f /app/data.comp ]; then echo 'TBENCH_VERIFY=NO_FILE'; exit 0; fi",
    "echo DATA_COMP_SIZE=$(wc -c < /app/data.comp)",
    "if [ $(wc -c < /app/data.comp) -gt 2500 ]; then echo 'TBENCH_VERIFY=SIZE_FAIL'; fi",
    "timeout 10s /app/decomp < /app/data.comp > /tmp/tbench.out 2>/tmp/tbench.err; rc=$?",
    "echo DECOMP_RC=$rc",
    "if [ -s /tmp/tbench.err ]; then echo DECOMP_STDERR_START; cat /tmp/tbench.err; echo DECOMP_STDERR_END; fi",
    "if [ $rc -eq 0 ] && cmp -s /tmp/tbench.out /app/data.txt && [ $(wc -c < /app/data.comp) -le 2500 ]; then echo 'TBENCH_VERIFY=PASS'; else echo 'TBENCH_VERIFY=FAIL'; echo OUT_SIZE=$(wc -c < /tmp/tbench.out 2>/dev/null || echo 0); cmp -l /tmp/tbench.out /app/data.txt 2>/dev/null | head -20 || true; fi"
  ].join("; ");
}

export function parseTerminalBenchVerification(stdout: string, stderr = ""): TerminalVerificationResult {
  const combined = `${stdout}\n${stderr}`;
  const sizeBytes = extractNumber(combined, /DATA_COMP_SIZE=(\d+)/);
  const decompExitCode = extractNumber(combined, /DECOMP_RC=(\d+)/);
  const outputSizeBytes = extractNumber(combined, /OUT_SIZE=(\d+)/);
  const explicit = extractExplicitStatus(combined);
  const status = classifyStatus(explicit, combined, decompExitCode);
  const reasons = statusReasons(status, { sizeBytes, decompExitCode, outputSizeBytes, stderr });
  return {
    status,
    hardGatePassed: status === "pass",
    reasons,
    sizeBytes,
    decompExitCode,
    outputSizeBytes
  };
}

function extractExplicitStatus(text: string): string | undefined {
  const match = text.match(/TBENCH_VERIFY=([A-Z_]+)/);
  return match?.[1];
}

function classifyStatus(explicit: string | undefined, text: string, decompExitCode?: number): TerminalVerificationStatus {
  if (explicit === "PASS") return "pass";
  if (explicit === "NO_FILE") return "no_file";
  if (explicit === "SIZE_FAIL") return "size_fail";
  if (decompExitCode !== undefined && decompExitCode !== 0) return "crash";
  if (/timed out|timeout|killed/i.test(text)) return "timeout";
  if (explicit === "FAIL") return "output_mismatch";
  return explicit ? "fail" : "unknown";
}

function statusReasons(
  status: TerminalVerificationStatus,
  metrics: { sizeBytes?: number; decompExitCode?: number; outputSizeBytes?: number; stderr?: string }
): string[] {
  switch (status) {
    case "pass":
      return ["compressed output exists, is within size limit, decompresses, and matches /app/data.txt"];
    case "no_file":
      return ["missing /app/data.comp"];
    case "size_fail":
      return [`/app/data.comp exceeds 2500 bytes${metrics.sizeBytes !== undefined ? ` (${metrics.sizeBytes} bytes)` : ""}`];
    case "crash":
      return [`/app/decomp exited with ${metrics.decompExitCode ?? "non-zero"}${metrics.stderr ? "; stderr was present" : ""}`];
    case "output_mismatch":
      return [`decompressed output did not match /app/data.txt${metrics.outputSizeBytes !== undefined ? ` (output ${metrics.outputSizeBytes} bytes)` : ""}`];
    case "timeout":
      return ["verification timed out"];
    case "fail":
      return ["hard gate failed"];
    default:
      return ["verification status was not recognized"];
  }
}

function extractNumber(text: string, pattern: RegExp): number | undefined {
  const match = text.match(pattern);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}
