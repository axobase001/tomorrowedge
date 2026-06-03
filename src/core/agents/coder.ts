import { makeId } from "../../utils/ids.js";
import type { PatchCandidate } from "../../schemas/patchCandidate.js";
import type { Plan } from "../../schemas/plan.js";
import type { ContextSelection } from "../context/fileSelector.js";
import { BaseAgent } from "./baseAgent.js";

export class CoderAgent extends BaseAgent<{ plan: Plan; contextSelection: ContextSelection; variant: "a" | "b"; fixtureMode?: boolean; fixtureFailingPatch?: boolean }, PatchCandidate> {
  readonly role: string = "coder";

  async run(input: { plan: Plan; contextSelection: ContextSelection; variant: "a" | "b"; fixtureMode?: boolean; fixtureFailingPatch?: boolean }): Promise<PatchCandidate> {
    if (input.fixtureMode && input.contextSelection.selectedFiles.some((file) => file.path === "index.js")) {
      return createFixtureCandidate(input.variant, input.plan, Boolean(input.fixtureFailingPatch));
    }
    return {
      candidateId: makeId(`candidate_${input.variant}`),
      agentId: `coder_${input.variant}`,
      approach: input.variant === "a" ? "minimal_patch" : "alternative",
      summary: `Offline candidate ${input.variant.toUpperCase()} prepared for review. No file writes performed.`,
      filesChanged: [],
      unifiedDiff: "",
      testPlan: input.plan.verificationCommands ?? [],
      knownTradeoffs: ["Fixture skeleton does not modify files until a real candidate diff is produced."],
      estimatedRisk: input.plan.riskLevel
    };
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
