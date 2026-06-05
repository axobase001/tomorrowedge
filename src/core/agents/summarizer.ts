import type { FinalSummary } from "../../schemas/evidence.js";
import type { Plan } from "../../schemas/plan.js";
import { BaseAgent } from "./baseAgent.js";

export class SummarizerAgent extends BaseAgent<{ plan: Plan; changedFiles: string[]; testsRun: string[]; evidence: string[] }, FinalSummary> {
  readonly role = "summarizer";

  async run(input: { plan: Plan; changedFiles: string[]; testsRun: string[]; evidence: string[] }): Promise<FinalSummary> {
    const hasPassingEvidence = input.evidence.some((item) => item.startsWith("Command passed:"));
    const onlySkippedVerification = input.testsRun.length > 0 && input.evidence.some((item) => item.startsWith("Command skipped:")) && !input.evidence.some((item) => item.startsWith("Command failed:"));
    const result = input.changedFiles.length && input.testsRun.length ? (hasPassingEvidence || onlySkippedVerification ? "completed" : "failed") : "partially_completed";
    return {
      task: input.plan.goal,
      result,
      changedFiles: input.changedFiles,
      testsRun: input.testsRun,
      evidence: input.evidence,
      risksRemaining: input.changedFiles.length ? (onlySkippedVerification ? ["Patch applied but verification was skipped."] : input.testsRun.length ? [] : ["Patch applied but no test command was run."]) : ["No patch was applied."],
      suggestedCommitMessage: `Implement ${input.plan.taskType} task`
    };
  }
}
