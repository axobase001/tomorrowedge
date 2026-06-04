import React from "react";
import { Box, Text } from "ink";
import type { PatchCandidate } from "../../schemas/patchCandidate.js";
import { DiffViewer } from "../components/DiffViewer.js";

export function DiffPane({
  candidate,
  candidates = [],
  repairCandidates = [],
  active = false
}: {
  candidate?: PatchCandidate;
  candidates?: PatchCandidate[];
  repairCandidates?: PatchCandidate[];
  active?: boolean;
}) {
  const allCandidates = [...candidates, ...repairCandidates];
  const selected = candidate ?? allCandidates[0];
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={active ? "cyan" : "gray"} paddingX={1}>
      <Text bold>Diff</Text>
      {allCandidates.slice(0, 6).map((item) => (
        <Text key={item.candidateId} color={item.candidateId === selected?.candidateId ? "cyan" : "gray"}>
          {item.candidateId}{repairCandidates.includes(item) ? " repair" : ""}: {item.filesChanged.join(", ") || "no files"} risk={item.estimatedRisk}
        </Text>
      ))}
      <Text color="gray">{selected?.candidateId ?? "no candidate selected"}</Text>
      <DiffViewer diff={selected?.unifiedDiff ?? ""} />
    </Box>
  );
}
