import type { RunResult } from "../../schemas/evidence.js";
import type { PatchCandidate } from "../../schemas/patchCandidate.js";
import type { Plan } from "../../schemas/plan.js";
import { BaseAgent } from "./baseAgent.js";

export class RepairerAgent extends BaseAgent<{ plan: Plan; failedRun: RunResult; appliedFiles: string[]; fixtureMode?: boolean }, PatchCandidate> {
  readonly role = "repairer";

  async run(input: { plan: Plan; failedRun: RunResult; appliedFiles: string[]; fixtureMode?: boolean }): Promise<PatchCandidate> {
    if (input.fixtureMode && input.appliedFiles.includes("index.js")) {
      return {
        candidateId: "fixture_repair_candidate",
        agentId: "repairer",
        approach: "repair",
        summary: "Repairs the fixture by replacing the failing multiplication patch with addition.",
        filesChanged: ["index.js"],
        unifiedDiff: `--- a/index.js
+++ b/index.js
@@ -1,5 +1,5 @@
 export function add(a, b) {
-  return a * b;
+  return a + b;
 }
 
 export default add;
`,
        testPlan: input.plan.verificationCommands ?? ["npm test"],
        knownTradeoffs: ["Deterministic fixture repair candidate."],
        estimatedRisk: "low"
      };
    }

    return {
      candidateId: "repair_candidate_pending",
      agentId: "repairer",
      approach: "repair",
      summary: "Repair analysis captured the failed command, but no deterministic repair patch is available.",
      filesChanged: [],
      unifiedDiff: "",
      testPlan: input.plan.verificationCommands ?? [],
      knownTradeoffs: [`Failed command: ${input.failedRun.command}`],
      estimatedRisk: input.plan.riskLevel
    };
  }
}
