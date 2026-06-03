import React from "react";
import { Box, Text } from "ink";
import type { PatchCandidate } from "../../schemas/patchCandidate.js";
import { DiffViewer } from "../components/DiffViewer.js";

export function DiffPane({ candidate }: { candidate?: PatchCandidate }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text bold>Diff</Text>
      <Text color="gray">{candidate?.candidateId ?? "未选择候选"}</Text>
      <DiffViewer diff={candidate?.unifiedDiff ?? ""} />
    </Box>
  );
}
