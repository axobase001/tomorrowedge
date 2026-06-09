import { makeId } from "../../utils/ids.js";
import type { PatchCandidate } from "../../schemas/patchCandidate.js";
import type { Plan } from "../../schemas/plan.js";
import type { StructuredVisualSpec } from "../../schemas/visualSpec.js";
import type { ContextSelection } from "../context/fileSelector.js";
import type { MemoryDerivedConstraint } from "../memory/failureMemoryInfluence.js";
import { BaseAgent } from "./baseAgent.js";

type CoderInput = {
  plan: Plan;
  contextSelection: ContextSelection;
  variant: "a" | "b";
  fixtureMode?: boolean;
  fixtureFailingPatch?: boolean;
  visualSpec?: StructuredVisualSpec;
  memoryConstraints?: MemoryDerivedConstraint[];
};

export class CoderAgent extends BaseAgent<CoderInput, PatchCandidate> {
  readonly role: string = "coder";

  async run(input: CoderInput): Promise<PatchCandidate> {
    if (input.fixtureMode && input.contextSelection.selectedFiles.some((file) => file.path === "index.js")) {
      return applyMemoryConstraints(createFixtureCandidate(input.variant, input.plan, Boolean(input.fixtureFailingPatch)), input.memoryConstraints ?? []);
    }
    const visualSummary = input.visualSpec ? ` Visual handoff: ${input.visualSpec.summary}` : "";
    return applyMemoryConstraints({
      candidateId: makeId(`candidate_${input.variant}`),
      agentId: `coder_${input.variant}`,
      approach: input.variant === "a" ? "minimal_patch" : "alternative",
      summary: `[MOCK] Offline candidate ${input.variant.toUpperCase()} prepared for review. No file writes performed.${visualSummary}`,
      filesChanged: [],
      unifiedDiff: "",
      testPlan: input.plan.verificationCommands ?? [],
      knownTradeoffs: [
        "Fixture skeleton does not modify files until a real candidate diff is produced.",
        ...(input.visualSpec ? ["Visual spec is preserved as a structured handoff for live patch generation or human review."] : [])
      ],
      estimatedRisk: input.plan.riskLevel
    }, input.memoryConstraints ?? []);
  }
}

function createFixtureCandidate(variant: "a" | "b", plan: Plan, failingPatch: boolean): PatchCandidate {
  if (variant === "b") {
    return {
      candidateId: "fixture_candidate_b",
      agentId: "coder_b",
      approach: "alternative",
      summary: "Alternative fixture candidate leaves implementation unchanged and should lose review.",
      filesChanged: [],
      unifiedDiff: "",
      testPlan: plan.verificationCommands ?? ["npm test"],
      knownTradeoffs: ["No concrete fix is proposed."],
      estimatedRisk: "low"
    };
  }
  return {
    candidateId: "fixture_candidate_a",
    agentId: "coder_a",
    approach: "minimal_patch",
    summary: failingPatch
      ? "Fixture repair demo: intentionally proposes a wrong multiplication patch so the repair loop can run."
      : "Fixes the sample add() implementation by changing subtraction to addition.",
    filesChanged: ["index.js"],
    unifiedDiff: `--- a/index.js
+++ b/index.js
@@ -1,5 +1,5 @@
 export function add(a, b) {
-  return a - b;
+  return a ${failingPatch ? "*" : "+"} b;
 }
 
 export default add;
`,
    testPlan: plan.verificationCommands ?? ["npm test"],
    knownTradeoffs: ["Fixture patch is intentionally minimal."],
    estimatedRisk: "low"
  };
}

function applyMemoryConstraints(candidate: PatchCandidate, constraints: MemoryDerivedConstraint[]): PatchCandidate {
  if (!constraints.length) return candidate;
  return {
    ...candidate,
    testPlan: uniqueStrings([
      ...candidate.testPlan,
      ...constraints.filter((constraint) => constraint.kind === "test_command" && constraint.command).map((constraint) => constraint.command!)
    ]),
    knownTradeoffs: uniqueStrings([
      ...candidate.knownTradeoffs,
      ...constraints.slice(0, 6).map((constraint) => `Memory constraint ${constraint.memoryId}: ${constraint.text}`)
    ])
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
