import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { generateNativeObjectiveContract } from "../../src/core/contracts/contractGenerator.js";
import { contractToPlan, overlayPlanWithContract } from "../../src/core/contracts/contractToPlan.js";
import { verifyAndRepairContract } from "../../src/core/contracts/contractVerifier.js";
import type { WorkflowIntentDecision } from "../../src/core/goal/workflowIntent.js";
import { defaultOrchestrationPolicy } from "../../src/core/orchestrationPolicy/orchestrationPolicy.js";
import { applyPolicyToContract, contractToolGate, contractVerificationBlocksExecution, effectiveMaxRepairRounds, effectiveMaxShellRuns, traceCompletenessThreshold } from "../../src/core/orchestrationPolicy/runtimePolicy.js";
import type { ScenarioProfile, ScenarioType } from "../../src/core/scenarios/scenarioTypes.js";
import type { Plan } from "../../src/schemas/plan.js";

describe("objective contracts", () => {
  it("generates and verifies a contract-first patch workflow", () => {
    const workflowIntent = workflowIntentFixture("fix failing test", "patch");
    const scenarioProfile = scenarioProfileFixture({ scenarioType: "debugging", workflowKind: "patch" });
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
    const workflowIntent = workflowIntentFixture("fix failing test", "patch");
    const scenarioProfile = scenarioProfileFixture({ scenarioType: "debugging", workflowKind: "patch" });
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

  it("does not require full npm test for document-only file creation contracts", () => {
    const goal = [
      "Create a new file assignments/gpt55-smoke-test/README.md.",
      "Write a short Chinese explanation and do not modify any other files."
    ].join("\n");
    const workflowIntent = workflowIntentFixture(goal, "patch");
    const scenarioProfile = scenarioProfileFixture({ scenarioType: "document", workflowKind: "patch" });
    const contract = generateNativeObjectiveContract({
      goal,
      workflowIntent,
      scenarioProfile,
      retrievedTraces: [],
      config: defaultConfig,
      accessMode: "partial"
    });

    expect(contract.verificationRubric.requiredCommands).not.toContain("npm test");
  });

  it("does not reinsert npm test when the user explicitly asks for bounded verification only", () => {
    const goal = [
      "Create files under assignments/sine-integral-residue/: solution.md, solution.html, contour.svg, README.md, and solution.pdf if the environment supports PDF generation.",
      "Verification must only check generated file existence, HTML openability, and SVG readability; do not run full npm test."
    ].join("\n");
    const workflowIntent = workflowIntentFixture(goal, "patch");
    const scenarioProfile = scenarioProfileFixture({ scenarioType: "coding", workflowKind: "patch" });
    const contract = generateNativeObjectiveContract({
      goal,
      workflowIntent,
      scenarioProfile,
      retrievedTraces: [],
      config: defaultConfig,
      accessMode: "full"
    });

    expect(contract.verificationRubric.requiredCommands).not.toContain("npm test");
    expect(contract.verificationRubric.requiredCommands[0]).toContain("node scripts/bounded-file-verifier.mjs");
    const payload = JSON.parse(Buffer.from(contract.verificationRubric.requiredCommands[0].split(/\s+/).at(-1) ?? "", "base64url").toString("utf8")) as { files: string[] };
    expect(payload.files).toEqual([
      "assignments/sine-integral-residue/solution.md",
      "assignments/sine-integral-residue/solution.html",
      "assignments/sine-integral-residue/contour.svg",
      "assignments/sine-integral-residue/README.md"
    ]);
    expect(payload.files).not.toContain("assignments/sine-integral-residue/solution.pdf");

    const overlaid = overlayPlanWithContract({
      goal,
      constraints: [],
      riskLevel: "medium",
      taskType: "feature",
      workflowKind: "patch",
      requiresPatchWorkflow: true,
      acceptanceCriteria: [],
      steps: [],
      verificationCommands: ["test -f assignments/sine-integral-residue/solution.md && xmllint --noout assignments/sine-integral-residue/contour.svg"],
      debateRecommended: false
    }, contract);
    expect(overlaid.verificationCommands).toEqual(contract.verificationRubric.requiredCommands);
  });

  it("overlays model/native plans without relaxing the contract", () => {
    const workflowIntent = workflowIntentFixture("fix failing test", "patch");
    const scenarioProfile = scenarioProfileFixture({ scenarioType: "debugging", workflowKind: "patch" });
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

  it("lets policy genome depth and planning fields change contract-derived runtime plan", () => {
    const workflowIntent = workflowIntentFixture("fix failing test", "patch");
    const scenarioProfile = scenarioProfileFixture({ scenarioType: "debugging", workflowKind: "patch" });
    const base = generateNativeObjectiveContract({
      goal: "fix failing test",
      workflowIntent,
      scenarioProfile,
      retrievedTraces: [],
      config: defaultConfig,
      accessMode: "partial"
    });
    const strictPolicy = {
      ...defaultOrchestrationPolicy("2026-06-10T00:00:00.000Z"),
      contractPolicy: { ...defaultOrchestrationPolicy().contractPolicy, contractDepth: "strict" as const, successCriteriaCount: 5 },
      planningPolicy: { ...defaultOrchestrationPolicy().planningPolicy, maxStepsMode: "conservative" as const, requirePlanStepEvidenceBinding: true },
      verificationPolicy: { ...defaultOrchestrationPolicy().verificationPolicy, verificationStrictness: "strict" as const }
    };
    const lightPolicy = {
      ...strictPolicy,
      contractPolicy: { ...strictPolicy.contractPolicy, contractDepth: "light" as const, successCriteriaCount: 1, requireEvidence: false },
      planningPolicy: { ...strictPolicy.planningPolicy, maxStepsMode: "aggressive" as const, requirePlanStepEvidenceBinding: false },
      verificationPolicy: { ...strictPolicy.verificationPolicy, verificationStrictness: "light" as const, requireEvidencePacket: false }
    };

    const strictContract = applyPolicyToContract(base, strictPolicy);
    const lightContract = applyPolicyToContract(base, lightPolicy);
    const strictPlan = contractToPlan(strictContract, strictPolicy);
    const lightPlan = contractToPlan(lightContract, lightPolicy);

    expect(strictContract.requiredEvidence).toEqual(expect.arrayContaining(["trace completeness", "objective-action-feedback trace"]));
    expect(lightContract.successCriteria.length).toBeLessThan(strictContract.successCriteria.length);
    expect(strictPlan.steps.length).toBeLessThanOrEqual(6);
    expect(strictPlan.steps.map((step) => step.detail).join("\n")).toContain("Evidence binding:");
    expect(lightPlan.steps.map((step) => step.detail).join("\n")).not.toContain("Evidence binding:");
  });

  it("enforces contract tool gates and failed-contract execution gates", () => {
    const workflowIntent = workflowIntentFixture("fix failing test", "patch");
    const scenarioProfile = scenarioProfileFixture({ scenarioType: "debugging", workflowKind: "patch" });
    const contract = generateNativeObjectiveContract({
      goal: "fix failing test",
      workflowIntent,
      scenarioProfile,
      retrievedTraces: [],
      config: defaultConfig,
      accessMode: "partial"
    });
    const forbiddenShellContract = {
      ...contract,
      forbiddenActions: [...contract.forbiddenActions, "run_shell"]
    };

    expect(contractToolGate(forbiddenShellContract, "shell")).toMatchObject({ allowed: false });
    expect(contractToolGate(contract, "patch_apply")).toMatchObject({ allowed: true });
    expect(contractVerificationBlocksExecution({
      status: "failed",
      score: 10,
      missing: [],
      violations: ["forbidden action was present in allowedTools"],
      repairs: []
    })).toBe(true);
  });

  it("uses policy and contract budgets for repair, shell, and trace strictness", () => {
    const workflowIntent = workflowIntentFixture("fix failing test", "patch");
    const scenarioProfile = scenarioProfileFixture({ scenarioType: "debugging", workflowKind: "patch" });
    const contract = generateNativeObjectiveContract({
      goal: "fix failing test",
      workflowIntent,
      scenarioProfile,
      retrievedTraces: [],
      config: defaultConfig,
      accessMode: "partial"
    });
    const strictPolicy = {
      ...defaultOrchestrationPolicy("2026-06-10T00:00:00.000Z"),
      repairPolicy: { ...defaultOrchestrationPolicy().repairPolicy, maxRepairRounds: 1 },
      verificationPolicy: { ...defaultOrchestrationPolicy().verificationPolicy, verificationStrictness: "strict" as const },
      stopPolicy: { ...defaultOrchestrationPolicy().stopPolicy, stopMode: "evidence_strict" as const }
    };

    expect(effectiveMaxRepairRounds(defaultConfig, contract, strictPolicy)).toBe(1);
    expect(effectiveMaxShellRuns(defaultConfig, { ...contract, budget: { ...contract.budget, maxShellRuns: 2 } })).toBe(2);
    expect(traceCompletenessThreshold(strictPolicy)).toBe(90);
  });
});

function workflowIntentFixture(goal: string, workflowKind: WorkflowIntentDecision["workflowKind"]): WorkflowIntentDecision {
  const requiresPatchWorkflow = workflowKind === "patch" || workflowKind === "repair" || workflowKind === "vision_patch";
  return {
    intent: requiresPatchWorkflow ? "patch" : "inspect",
    requiresPatchWorkflow,
    workflowKind,
    confidence: 1,
    reason: `Test fixture declares ${workflowKind} workflow for ${goal}.`,
    provider: "test_fixture",
    model: "semantic-fixture",
    fallbackUsed: false
  };
}

function scenarioProfileFixture(input: { scenarioType: ScenarioType; workflowKind: ScenarioProfile["likelyWorkflowKind"] }): ScenarioProfile {
  return {
    scenarioType: input.scenarioType,
    userIntent: `${input.scenarioType} fixture intent`,
    expectedDeliverable: input.workflowKind === "read_only" ? "read-only answer with evidence" : "patch workflow evidence",
    ambiguityLevel: "low",
    likelyWorkflowKind: input.workflowKind,
    riskSignals: input.scenarioType === "debugging" ? ["correctness_critical"] : [],
    evidenceNeeds: input.workflowKind === "read_only" ? ["event ledger", "inspected context"] : ["event ledger", "patch diff", "review decision", "judge decision"],
    suggestedRoles: input.workflowKind === "read_only" ? ["planner", "explorer", "summarizer"] : ["planner", "explorer", "coder_a", "reviewer", "judge", "runner", "summarizer"]
  };
}
