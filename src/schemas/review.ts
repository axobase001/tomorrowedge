export type RedTeamFinding = {
  id: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  detail: string;
  requiresHumanAttention: boolean;
};

export type CandidateReview = {
  candidateId: string;
  correctnessScore: number;
  riskScore: number;
  invasiveness: "low" | "medium" | "high";
  testCoverage: "none" | "weak" | "adequate" | "strong";
  securityConcerns: string[];
  regressionConcerns: string[];
  redTeamFindings: RedTeamFinding[];
  recommendation: "accept" | "accept_with_minor_change" | "revise" | "reject";
  notes: string[];
};

export type ReviewReport = {
  mode: "standard" | "red_team";
  reviews: CandidateReview[];
  overallRecommendation: string;
};
