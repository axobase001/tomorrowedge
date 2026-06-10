export type JudgeDecision = {
  selectedCandidateId?: string;
  decision: "select" | "request_revision" | "ask_user" | "abort";
  reason: string;
  borrowIdeasFromOtherCandidates?: string[];
  acceptedClaims?: string[];
  rejectedClaims?: string[];
  unresolvedBlockingIssues?: string[];
  unresolvedIssueIds?: string[];
  evidenceCoverageScore?: number;
  confidence: number;
  requiredUserDecision?: string;
};
