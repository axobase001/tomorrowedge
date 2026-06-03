export type DebateRound = {
  round: number;
  speaker: string;
  targetCandidateId?: string;
  claim: string;
  evidence: string[];
  riskRaised?: string;
};
