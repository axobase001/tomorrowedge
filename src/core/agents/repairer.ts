import type { RunResult } from "../../schemas/evidence.js";
import type { PatchCandidate } from "../../schemas/patchCandidate.js";
import type { Plan } from "../../schemas/plan.js";
import type { RepairMemoryContext } from "../memory/failureMemoryInfluence.js";
import { BaseAgent } from "./baseAgent.js";

export class RepairerAgent extends BaseAgent<{ plan: Plan; failedRun: RunResult; appliedFiles: string[]; fixtureMode?: boolean; memoryContext?: RepairMemoryContext }, PatchCandidate> {
  readonly role = "repairer";

  async run(input: { plan: Plan; failedRun: RunResult; appliedFiles: string[]; fixtureMode?: boolean; memoryContext?: RepairMemoryContext }): Promise<PatchCandidate> {
    if (input.fixtureMode && input.appliedFiles.includes("index.js")) {
      return applyRepairMemoryContext({
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
      }, input.memoryContext);
    }

    return applyRepairMemoryContext({
      candidateId: "repair_candidate_pending",
      agentId: "repairer",
      approach: "repair",
      summary: "Repair analysis captured the failed command; no safe deterministic repair patch is available for this failure class.",
      filesChanged: [],
      unifiedDiff: "",
      testPlan: input.plan.verificationCommands ?? [],
      knownTradeoffs: [`Failed command: ${input.failedRun.command}`],
      estimatedRisk: input.plan.riskLevel
    }, input.memoryContext);
  }
}

function applyRepairMemoryContext(candidate: PatchCandidate, context?: RepairMemoryContext): PatchCandidate {
  if (!context?.constraints.length) return candidate;
  return {
    ...candidate,
    testPlan: uniqueStrings([
      ...candidate.testPlan,
      ...context.constraints.filter((constraint) => constraint.kind === "test_command" && constraint.command).map((constraint) => constraint.command!)
    ]),
    knownTradeoffs: uniqueStrings([
      ...candidate.knownTradeoffs,
      ...context.corrections.slice(0, 4).map((correction) => `Retrieved repair correction: ${correction}`)
    ])
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
