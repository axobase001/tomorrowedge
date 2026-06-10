import type { AgentRole } from "../../schemas/agentTask.js";

export type DebateMoveType = "claim" | "challenge" | "rebuttal" | "concession" | "resolution";

export type DebateClaimStatus = "accepted" | "rejected" | "unresolved";

export type DebateClaim = {
  id: string;
  speaker: AgentRole | string;
  targetCandidateId?: string;
  claim: string;
  evidenceRefs: string[];
  status: DebateClaimStatus;
  blocking?: boolean;
};

export type DebateIssue = {
  id: string;
  candidateId?: string;
  title: string;
  blocking: boolean;
  status: "open" | "resolved" | "rejected";
  requiredEvidence: string[];
  relatedMoveIds: string[];
};

export type DebateMove = {
  id: string;
  round: number;
  speaker: AgentRole | string;
  moveType: DebateMoveType;
  targetClaimId?: string;
  targetCandidateId?: string;
  content: string;
  evidenceRefs: string[];
  riskSignal?: string;
};

export type DebateResolutionStatus = "selectable" | "request_revision" | "needs_user";

export type DebateCandidateResolution = {
  resolution: DebateResolutionStatus;
  unresolvedBlockingIssues: string[];
  unresolvedIssues: DebateIssue[];
};

export type DebateSession = {
  sessionId: string;
  maxRounds: number;
  moves: DebateMove[];
  claims: DebateClaim[];
  issues: DebateIssue[];
  unresolvedIssues: DebateIssue[];
  acceptedClaims: string[];
  rejectedClaims: string[];
  candidateResolutions: Record<string, DebateCandidateResolution>;
  globalResolution: DebateCandidateResolution;
  /**
   * Compatibility view for older trace readers. It contains only global blocking
   * issues and no longer treats losing-candidate issues as workflow-wide.
   */
  unresolvedBlockingIssues: string[];
  evidenceCoverageScore: number;
  resolution: DebateResolutionStatus;
};
