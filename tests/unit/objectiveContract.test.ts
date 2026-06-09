import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { generateNativeObjectiveContract } from "../../src/core/contracts/contractGenerator.js";
import { contractToPlan, overlayPlanWithContract } from "../../src/core/contracts/contractToPlan.js";
import { verifyAndRepairContract } from "../../src/core/contracts/contractVerifier.js";
import { classifyWorkflowIntentLocally, type WorkflowIntentDecision } from "../../src/core/goal/workflowIntent.js";
import { profileScenario } from "../../src/core/scenarios/scenarioProfiler.js";
import type { Plan } from "../../src/schemas/plan.js";

describe("objective contracts", () => {
  it("generates and verifies a contract-first patch workflow", () => {
    const workflowIntent = withProvider(classifyWorkflowIntentLocally("fix failing test"));
    const scenarioProfile = profileScenario({ goal: "fix failing test", workflowIntent, accessMode: "partial" });
    const contract = generateNativeObjectiveContract({
      goal: "fix failing test",
      workflowIntent,
      scenarioProfile,
      retrievedTraces: [],
      config: defaultConfig,
      accessMode: "partial"
    });
    const result = verifyAndRepairContract(contract, { accessMode: "partial", workflowIntent, scenarioProfile, config: defaultConfig, baseline: contract });
    const plan = contractToPlan(result.contract);

    expect(result.verification.status).toBe("passed");
    expect(result.contract.workflowKind).toBe("patch");
    expect(result.contract.requiredEvidence).toEqual(expect.arrayContaining(["objective contract", "review decision", "judge decision"]));
    expect(plan.requiresPatchWorkflow).toBe(true);
    expect(plan.constraints.join("\n")).toContain("Required evidence");
  });

  it("downgrades mutation contracts in restricted mode", () => {
    const workflowIntent = withProvider(classifyWorkflowIntentLocally("fix failing test"));
    const scenarioProfile = profileScenario({ goal: "fix failing test", workflowIntent, accessMode: "restricted" });
    const contract = generateNativeObjectiveContract({
      goal: "fix failing test",
      workflowIntent,
      scenarioProfile,
      retrievedTraces: [],
      config: defaultConfig,
      accessMode: "restricted"
    });
    const result = verifyAndRepairContract(contract, { accessMode: "restricted", workflowIntent, scenarioProfile, config: defaultConfig, baseline: contract });

    expect(result.contract.workflowKind).toBe("read_only");
    expect(result.contract.allowedTools).not.toEqual(expect.arrayContaining(["patch_apply", "shell"]));
    expect(result.contract.forbiddenActions).toEqual(expect.arrayContaining(["write_files", "apply_patch", "run_shell"]));
  });

  it("overlays model/native plans without relaxing the contract", () => {
    const workflowIntent = withProvider(classifyWorkflowIntentLocally("fix failing test"));
    const scenarioProfile = profileScenario({ goal: "fix failing test", workflowIntent, accessMode: "partial" });
    const contract = generateNativeObjectiveContract({
      goal: "fix failing test",
      workflowIntent,
      scenarioProfile,
      retrievedTraces: [],
      config: defaultConfig,
      accessMode: "partial"
    });
    const unsafePlan: Plan = {
      goal: "skip evidence",
      constraints: [],
      riskLevel: "low",
      taskType: "analysis",
      workflowKind: "read_only",
      requiresPatchWorkflow: false,
      acceptanceCriteria: [],
      steps: [{ id: "shortcut", title: "Shortcut", detail: "Do not review.", status: "pending" }],
      verificationCommands: [],
      debateRecommended: false
    };
    const overlaid = overlayPlanWithContract(unsafePlan, contract);

    expect(overlaid.workflowKind).toBe("patch");
    expect(overlaid.requiresPatchWorkflow).toBe(true);
    expect(overlaid.acceptanceCriteria).toEqual(expect.arrayContaining(contract.successCriteria));
    expect(overlaid.constraints.join("\n")).toContain("Forbidden action: bypass_event_ledger");
    expect(overlaid.verificationCommands).toEqual(expect.arrayContaining(contract.verificationRubric.requiredCommands));
  });
});

function withProvider(decision: Omit<WorkflowIntentDecision, "provider" | "model" | "fallbackUsed">): WorkflowIntentDecision {
  return { ...decision, provider: "test", model: "local" };
}
