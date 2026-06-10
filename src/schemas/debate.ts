export type DebateRound = {
  round: number;
  speaker: string;
  targetCandidateId?: string;
  claim: string;
  evidence: string[];
  riskRaised?: string;
};

export type { DebateClaim, DebateMove, DebateSession } from "../core/debate/debateProtocol.js";
