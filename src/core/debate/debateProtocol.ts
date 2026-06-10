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

export type DebateSession = {
  sessionId: string;
  maxRounds: number;
  moves: DebateMove[];
  claims: DebateClaim[];
  acceptedClaims: string[];
  rejectedClaims: string[];
  unresolvedBlockingIssues: string[];
  evidenceCoverageScore: number;
  resolution: "selectable" | "request_revision" | "needs_user";
};
