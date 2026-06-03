import type { SessionRecord } from "../memory/sessionMemory.js";

export type ReviewCommentExportFormat = "github" | "google-docs";

export type ReviewCommentDraft = {
  target: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "error";
};

export function buildReviewCommentDrafts(session: SessionRecord, format: ReviewCommentExportFormat): ReviewCommentDraft[] {
  const state = session.state;
  const drafts: ReviewCommentDraft[] = [];
  for (const review of state.review?.reviews ?? []) {
    const candidate = state.candidates.find((item) => item.candidateId === review.candidateId);
    drafts.push({
      target: candidate?.filesChanged[0] ?? "candidate",
      title: `${review.recommendation}: ${review.candidateId}`,
      body: [
        `Correctness: ${review.correctnessScore}`,
        `Risk: ${review.riskScore}`,
        `Notes: ${review.notes.join("; ") || "none"}`,
        candidate?.summary ? `Candidate summary: ${candidate.summary}` : undefined
      ].filter(Boolean).join("\n"),
      severity: review.recommendation === "reject" ? "error" : review.recommendation === "revise" ? "warning" : "info"
    });
    for (const finding of review.redTeamFindings ?? []) {
      drafts.push({
        target: candidate?.filesChanged[0] ?? "candidate",
        title: `${finding.severity}: ${finding.title}`,
        body: finding.detail,
        severity: finding.severity === "high" ? "error" : finding.severity === "medium" ? "warning" : "info"
      });
    }
  }
  if (!drafts.length) {
    drafts.push({
      target: "session",
      title: "No review comments",
      body: `Session ${session.sessionId} has no review report to export.`,
      severity: "info"
    });
  }
  return format === "github" ? drafts : drafts.map(toGoogleDocsDraft);
}

export function renderReviewCommentDrafts(drafts: ReviewCommentDraft[], format: ReviewCommentExportFormat): string {
  if (format === "github") {
    return drafts.map((draft) => [`### ${draft.title}`, `Target: ${draft.target}`, `Severity: ${draft.severity}`, "", draft.body].join("\n")).join("\n\n---\n\n");
  }
  return drafts.map((draft) => [`# ${draft.title}`, `Location: ${draft.target}`, `Priority: ${draft.severity}`, draft.body].join("\n")).join("\n\n");
}

function toGoogleDocsDraft(draft: ReviewCommentDraft): ReviewCommentDraft {
  return {
    ...draft,
    target: `Document section for ${draft.target}`,
    title: `Review note - ${draft.title}`
  };
}
