import type { FinalSummary } from "../../schemas/evidence.js";
import type { Plan } from "../../schemas/plan.js";
import { BaseAgent } from "./baseAgent.js";

export class SummarizerAgent extends BaseAgent<{ plan: Plan; changedFiles: string[]; testsRun: string[]; evidence: string[] }, FinalSummary> {
  readonly role = "summarizer";

  async run(input: { plan: Plan; changedFiles: string[]; testsRun: string[]; evidence: string[] }): Promise<FinalSummary> {
    const hasPassingEvidence = input.evidence.some((item) => item.startsWith("Command passed:"));
    const onlySkippedVerification = input.testsRun.length > 0 && input.evidence.some((item) => item.startsWith("Command skipped:")) && !input.evidence.some((item) => item.startsWith("Command failed:"));
    const docsOnlyPatch = input.plan.taskType === "docs" || input.changedFiles.every((file) => /\.(md|markdown|html?|txt|rst|adoc)$/i.test(file));
    const verificationFailed = input.testsRun.length > 0 && input.evidence.some((item) => item.startsWith("Command failed:"));
    const result = input.changedFiles.length && input.testsRun.length
      ? (hasPassingEvidence || onlySkippedVerification ? "completed" : docsOnlyPatch ? "partially_completed" : "failed")
      : "partially_completed";
    const risksRemaining = input.changedFiles.length
      ? onlySkippedVerification
        ? ["Patch applied but verification was skipped."]
        : verificationFailed && docsOnlyPatch
          ? ["Patch applied, but verification failed; inspect whether the failure is related to the requested document/content files."]
          : input.testsRun.length
            ? []
            : ["Patch applied but no test command was run."]
      : ["No patch was applied."];
    return {
      task: input.plan.goal,
      result,
      userReply: buildUserReply(input, result),
      userReplySource: "local",
      changedFiles: input.changedFiles,
      testsRun: input.testsRun,
      evidence: input.evidence,
      risksRemaining,
      suggestedCommitMessage: `Implement ${input.plan.taskType} task`
    };
  }
}

function buildUserReply(input: { plan: Plan; changedFiles: string[]; testsRun: string[]; evidence: string[] }, result: FinalSummary["result"]): string {
  if (result === "failed") {
    const failure = input.evidence.find((item) => item.startsWith("Command failed:")) ?? "Verification failed.";
    return `I could not complete the requested change safely. ${failure}`;
  }
  if (input.changedFiles.length) {
    const verification = input.testsRun.length ? ` Verification: ${input.testsRun.join(", ")}.` : " Verification was not run.";
    return `Done. I prepared changes in ${input.changedFiles.join(", ")}.${verification}`;
  }
  return "I completed the workflow without applying file changes.";
}
