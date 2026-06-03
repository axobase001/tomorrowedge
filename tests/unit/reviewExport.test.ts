import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../../src/core/memory/sessionMemory.js";
import { buildReviewCommentDrafts, renderReviewCommentDrafts } from "../../src/core/review/commentExport.js";

describe("review comment export", () => {
  it("renders GitHub-style drafts from review results", () => {
    const session = {
      sessionId: "session_test",
      createdAt: "2026-06-03T00:00:00.000Z",
      state: {
        goal: "fix bug",
        candidates: [{ candidateId: "candidate_a", agentId: "coder_a", approach: "minimal_patch", summary: "Fix bug", filesChanged: ["index.js"], unifiedDiff: "", testPlan: [], knownTradeoffs: [], estimatedRisk: "low" }],
        review: {
          mode: "standard",
          reviews: [{ candidateId: "candidate_a", recommendation: "accept", correctnessScore: 0.9, riskScore: 0.1, invasiveness: "low", testCoverage: "adequate", securityConcerns: [], regressionConcerns: [], notes: ["Good patch"], redTeamFindings: [] }],
          overallRecommendation: "select candidate_a"
        }
      }
    } as unknown as SessionRecord;

    const drafts = buildReviewCommentDrafts(session, "github");
    const rendered = renderReviewCommentDrafts(drafts, "github");

    expect(drafts[0]?.target).toBe("index.js");
    expect(rendered).toContain("Good patch");
  });
});
