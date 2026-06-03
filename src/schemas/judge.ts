export type JudgeDecision = {
  selectedCandidateId?: string;
  decision: "select" | "request_revision" | "ask_user" | "abort";
  reason: string;
  borrowIdeasFromOtherCandidates?: string[];
  confidence: number;
  requiredUserDecision?: string;
};
