import type { DebateIssue } from "../core/debate/debateProtocol.js";

export type JudgeDecision = {
  selectedCandidateId?: string;
  decision: "select" | "request_revision" | "ask_user" | "abort";
  reason: string;
  borrowIdeasFromOtherCandidates?: string[];
  acceptedClaims?: string[];
  rejectedClaims?: string[];
  unresolvedBlockingIssues?: string[];
  unresolvedIssueIds?: string[];
  selectedCandidateBlockingIssues?: DebateIssue[];
  globalBlockingIssues?: DebateIssue[];
  nonSelectedCandidateIssues?: DebateIssue[];
  evidenceCoverageScore?: number;
  confidence: number;
  requiredUserDecision?: string;
};
