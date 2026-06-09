import { describe, expect, it } from "vitest";
import { ReviewerAgent } from "../../src/core/agents/reviewer.js";
import { JudgeAgent } from "../../src/core/agents/judge.js";
import type { PatchCandidate } from "../../src/schemas/patchCandidate.js";

describe("reviewer and judge quality gates", () => {
  it("selects a concrete low-risk candidate with matching diff targets and tests", async () => {
    const candidate = candidateWithDiff({
      candidateId: "good",
      filesChanged: ["index.js"],
      unifiedDiff: `--- a/index.js
+++ b/index.js
@@ -1 +1 @@
-export const value = 1;
+export const value = 2;
`
    });
    const review = await new ReviewerAgent().run({ candidates: [candidate] });
    const judge = await new JudgeAgent().run({ candidates: [candidate], review });

    expect(review.reviews[0].recommendation).toBe("accept");
    expect(judge.decision).toBe("select");
    expect(judge.selectedCandidateId).toBe("good");
  });

  it("rejects mojibake-contaminated diffs before judge selection", async () => {
    const candidate = candidateWithDiff({
      candidateId: "mojibake",
      filesChanged: ["README.md"],
      unifiedDiff: `--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-锟斤拷 old text
+锟斤拷 new text
`
    });
    const review = await new ReviewerAgent().run({ candidates: [candidate] });
    const judge = await new JudgeAgent().run({ candidates: [candidate], review });

    expect(review.reviews[0].recommendation).toBe("reject");
    expect(review.reviews[0].regressionConcerns.join("\n")).toContain("mojibake");
    expect(judge.decision).toBe("request_revision");
    expect(judge.selectedCandidateId).toBeUndefined();
  });

  it("blocks automatic selection when filesChanged disagrees with diff targets", async () => {
    const candidate = candidateWithDiff({
      candidateId: "mismatch",
      filesChanged: ["README.md"],
      unifiedDiff: `--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -1 +1 @@
-old
+new
`
    });
    const review = await new ReviewerAgent().run({ candidates: [candidate] });
    const judge = await new JudgeAgent().run({ candidates: [candidate], review });

    expect(review.reviews[0].recommendation).toBe("revise");
    expect(review.reviews[0].regressionConcerns.join("\n")).toContain("filesChanged does not match");
    expect(judge.decision).toBe("request_revision");
  });

  it("includes debate evidence in native judge decisions", async () => {
    const candidate = candidateWithDiff({
      candidateId: "debated",
      filesChanged: ["index.js"],
      unifiedDiff: `--- a/index.js
+++ b/index.js
@@ -1 +1 @@
-export const value = 1;
+export const value = 2;
`
    });
    const review = await new ReviewerAgent().run({ candidates: [candidate] });
    const judge = await new JudgeAgent().run({
      candidates: [candidate],
      review,
      debateRounds: [{
        round: 1,
        speaker: "opponent",
        targetCandidateId: "debated",
        claim: "Reviewer challenges missing edge-case coverage.",
        evidence: ["test plan only has npm test"],
        riskRaised: "edge-case coverage may be thin"
      }]
    });

    expect(judge.decision).toBe("select");
    expect(judge.reason).toContain("Debate rounds considered=1");
    expect(judge.reason).toContain("edge-case coverage may be thin");
  });
});

function candidateWithDiff(overrides: Partial<PatchCandidate>): PatchCandidate {
  return {
    candidateId: "candidate",
    agentId: "coder_a",
    approach: "minimal_patch",
    summary: "test candidate",
    filesChanged: [],
    unifiedDiff: "",
    testPlan: ["npm test"],
    knownTradeoffs: [],
    estimatedRisk: "low",
    ...overrides
  };
}
