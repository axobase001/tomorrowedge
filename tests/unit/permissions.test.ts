import { describe, expect, it } from "vitest";
import { ApprovalGate } from "../../src/core/permissions/approvalGate.js";

describe("approval gate", () => {
  it("requires approval in safe mode", () => {
    const gate = new ApprovalGate(true);
    const decision = gate.requireApproval({ kind: "run_shell", risk: "low", summary: "npm test" });
    expect(decision.approved).toBe(false);
  });
});
