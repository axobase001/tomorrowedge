import React from "react";
import { Box, Text } from "ink";
import type { PatchCandidate } from "../../schemas/patchCandidate.js";
import type { ReviewReport } from "../../schemas/review.js";
import type { JudgeDecision } from "../../schemas/judge.js";
import type { DebateRound } from "../../schemas/debate.js";

export function DebatePane({
  candidates,
  review,
  judge,
  rounds = [],
  active = false
}: {
  candidates: PatchCandidate[];
  review?: ReviewReport;
  judge?: JudgeDecision;
  rounds?: DebateRound[];
  active?: boolean;
}) {
  const findings = review?.mode === "red_team" ? review.reviews.flatMap((item) => item.redTeamFindings).slice(0, 3) : [];

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={active ? "cyan" : "gray"} paddingX={1}>
      <Text bold>辩论</Text>
      {candidates.slice(0, 4).map((candidate) => (
        <Text key={candidate.candidateId}>
          {candidate.candidateId}: {candidate.summary.slice(0, 96)}
        </Text>
      ))}
      <Text color="gray">{review?.overallRecommendation ?? "等待审查"}</Text>
      {rounds.slice(0, 4).map((round) => (
        <Text key={`${round.round}-${round.speaker}-${round.targetCandidateId}`} color="gray">
          R{round.round}/{round.speaker}: {round.claim.slice(0, 88)}
        </Text>
      ))}
      {findings.map((finding) => (
        <Text key={finding.id} color={finding.severity === "low" ? "gray" : "yellow"}>
          红队/{finding.severity}: {finding.title}
        </Text>
      ))}
      <Text color="cyan">{judge ? `${judge.decision}: ${judge.reason}` : "等待裁决"}</Text>
    </Box>
  );
}
