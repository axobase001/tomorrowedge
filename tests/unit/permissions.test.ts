import { describe, expect, it } from "vitest";
import { ApprovalGate } from "../../src/core/permissions/approvalGate.js";
import { buildAccessPolicy, parseAccessMode } from "../../src/core/permissions/accessPolicy.js";
import { defaultConfig } from "../../src/config/defaultConfig.js";

describe("approval gate", () => {
  it("requires approval in safe mode", () => {
    const gate = new ApprovalGate(true);
    const decision = gate.requireApproval({ kind: "run_shell", risk: "low", summary: "npm test" });
    expect(decision.approved).toBe(false);
  });

  it("rejects invalid access modes", () => {
    expect(() => parseAccessMode("nonsense")).toThrow("Invalid access mode: nonsense");
    expect(() => buildAccessPolicy(defaultConfig, { mode: "nonsense" })).toThrow("Invalid access mode: nonsense");
  });
});
