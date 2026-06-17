import { createHash } from "node:crypto";
import type { RunResult } from "../../schemas/evidence.js";

export type RepairFailureClass =
  | "semantic_test_failure"
  | "deterministic_syntax_failure"
  | "environment_failure"
  | "provider_parse_failure"
  | "wrong_file_patch"
  | "missing_context"
  | "unknown_failure";

export type RepairPolicyAction = "repair" | "retry_schema" | "expand_context" | "stop" | "escalate";

export type RepairPolicyDecision = {
  failureClass: RepairFailureClass;
  failureSignature: string;
  occurrence: number;
  action: RepairPolicyAction;
  repairStatus?: "repairable" | "unsupported" | "retry_schema" | "stopped";
  strategy: string;
  reason: string;
};

export function decideRepairPolicy(input: {
  failedRun: RunResult;
  changedFiles: string[];
  previousOccurrences?: number;
}): RepairPolicyDecision {
  const failureClass = classifyRepairFailure(input.failedRun, input.changedFiles);
  const failureSignature = signatureForFailure(failureClass, input.failedRun, input.changedFiles);
  const occurrence = (input.previousOccurrences ?? 0) + 1;
  if (occurrence > 1) {
    return {
      failureClass,
      failureSignature,
      occurrence,
      action: "escalate",
      repairStatus: "stopped",
      strategy: "stop same-strategy repair and require broader review/context",
      reason: `Repeated ${failureClass} with the same signature (${occurrence} occurrences).`
    };
  }
  switch (failureClass) {
    case "provider_parse_failure":
      return {
        failureClass,
        failureSignature,
        occurrence,
        action: "retry_schema",
        repairStatus: "retry_schema",
        strategy: "retry provider output with stricter schema before patch repair",
        reason: "Failure looks like malformed model/provider output rather than a code defect."
      };
    case "deterministic_syntax_failure":
      return {
        failureClass,
        failureSignature,
        occurrence,
        action: "stop",
        repairStatus: "unsupported",
        strategy: "stop empty repair and require patch/artifact quality gate rejection",
        reason: "Failure is a deterministic syntax error, so the candidate should be rejected before selection or apply."
      };
    case "environment_failure":
      return {
        failureClass,
        failureSignature,
        occurrence,
        action: "stop",
        repairStatus: "stopped",
        strategy: "stop patch repair and ask operator/tooling check",
        reason: "Verifier failed because the local tool or environment appears unavailable."
      };
    case "wrong_file_patch":
      return {
        failureClass,
        failureSignature,
        occurrence,
        action: "expand_context",
        repairStatus: "stopped",
        strategy: "expand context or regenerate candidate before repair",
        reason: "No changed file evidence is available for the failing verification."
      };
    case "missing_context":
      return {
        failureClass,
        failureSignature,
        occurrence,
        action: "expand_context",
        repairStatus: "stopped",
        strategy: "read missing files or dependencies before repair",
        reason: "Verifier indicates missing module/file/context."
      };
    case "semantic_test_failure":
      return {
        failureClass,
        failureSignature,
        occurrence,
        action: "repair",
        repairStatus: "repairable",
        strategy: "repair patch using failing test stdout/stderr and retrieved corrections",
        reason: "Failure looks like a semantic test assertion or regression."
      };
    case "unknown_failure":
      return {
        failureClass,
        failureSignature,
        occurrence,
        action: "repair",
        repairStatus: "repairable",
        strategy: "attempt one conservative repair with full verifier evidence",
        reason: "Failure class is unknown, but repair is still allowed once."
      };
  }
}

export function classifyRepairFailure(run: RunResult, changedFiles: string[]): RepairFailureClass {
  const text = `${run.command}\n${run.stdout}\n${run.stderr}`.toLowerCase();
  if (/syntaxerror|identifier ['"`]?[a-z_$][\w$]*['"`]? has already been declared|has already been declared|unexpected token ['"`]?export['"`]?|duplicate (?:export|declaration|identifier)/i.test(text)) return "deterministic_syntax_failure";
  if (/json parse|invalid json|schema validation|zoderror|malformed.*json|unexpected token/.test(text)) return "provider_parse_failure";
  if (/not recognized|command not found|enoent|permission denied|access is denied|spawn .* enoent/.test(text)) return "environment_failure";
  if (/cannot find module|module not found|no such file|file not found|missing dependency/.test(text)) return "missing_context";
  if (!changedFiles.length || /wrong file|expected file|patch did not touch|required file/.test(text)) return "wrong_file_patch";
  if (/assertionerror|expected|received|test failed|failed tests?|should equal|to equal|断言|测试失败|期望|实际/.test(text)) return "semantic_test_failure";
  return "unknown_failure";
}

function signatureForFailure(failureClass: RepairFailureClass, run: RunResult, changedFiles: string[]): string {
  const normalized = `${failureClass}|${run.command}|${changedFiles.slice().sort().join(",")}|${run.exitCode ?? ""}|${run.stderr || run.stdout}`
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .slice(0, 500)
    .toLowerCase();
  return createHash("sha256").update(normalized).digest("hex");
}
