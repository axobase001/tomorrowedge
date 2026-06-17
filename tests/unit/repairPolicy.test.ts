import { describe, expect, it } from "vitest";
import { classifyRepairFailure, decideRepairPolicy } from "../../src/core/errorLoop/repairPolicy.js";
import type { RunResult } from "../../src/schemas/evidence.js";

describe("repair policy", () => {
  it("allows one semantic test repair", () => {
    const run = failedRun({ stdout: "AssertionError: expected 2 received 1" });
    const decision = decideRepairPolicy({ failedRun: run, changedFiles: ["index.js"] });

    expect(decision.failureClass).toBe("semantic_test_failure");
    expect(decision.action).toBe("repair");
    expect(decision.occurrence).toBe(1);
  });

  it("routes provider parse failures to schema retry", () => {
    const run = failedRun({ stderr: "invalid json: unexpected token }" });

    expect(classifyRepairFailure(run, ["index.js"])).toBe("provider_parse_failure");
    expect(decideRepairPolicy({ failedRun: run, changedFiles: ["index.js"] }).action).toBe("retry_schema");
  });

  it("marks deterministic syntax failures as unsupported repair targets", () => {
    const run = failedRun({ stderr: "SyntaxError: Identifier 'planRetries' has already been declared" });
    const decision = decideRepairPolicy({ failedRun: run, changedFiles: ["index.js"] });

    expect(decision.failureClass).toBe("deterministic_syntax_failure");
    expect(decision.action).toBe("stop");
    expect(decision.repairStatus).toBe("unsupported");
    expect(decision.reason).toContain("rejected before selection");
  });

  it("routes environment failures away from patch repair", () => {
    const run = failedRun({ stderr: "spawn cargo ENOENT" });
    const decision = decideRepairPolicy({ failedRun: run, changedFiles: ["index.js"] });

    expect(decision.failureClass).toBe("environment_failure");
    expect(decision.action).toBe("stop");
  });

  it("expands context when there is no changed-file evidence", () => {
    const run = failedRun({ stdout: "test failed" });
    const decision = decideRepairPolicy({ failedRun: run, changedFiles: [] });

    expect(decision.failureClass).toBe("wrong_file_patch");
    expect(decision.action).toBe("expand_context");
  });

  it("escalates repeated same-signature failures", () => {
    const run = failedRun({ command: "npm test", stdout: "AssertionError: expected 42 received 41 at line 12" });
    const first = decideRepairPolicy({ failedRun: run, changedFiles: ["index.js"] });
    const second = decideRepairPolicy({
      failedRun: failedRun({ command: "npm test", stdout: "AssertionError: expected 42 received 41 at line 13" }),
      changedFiles: ["index.js"],
      previousOccurrences: first.occurrence
    });

    expect(first.failureSignature).toBe(second.failureSignature);
    expect(second.occurrence).toBe(2);
    expect(second.action).toBe("escalate");
  });
});

function failedRun(overrides: Partial<RunResult>): RunResult {
  return {
    command: "npm test",
    exitCode: 1,
    stdout: "",
    stderr: "",
    durationMs: 12,
    success: false,
    ...overrides
  };
}
