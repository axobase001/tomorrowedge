import React from "react";
import { Box, Text } from "ink";
import type { AgentGraphState } from "../../core/agentGraph/state.js";

export function ApprovalPrompt({ graph }: { graph: AgentGraphState }) {
  const pending = pendingActions(graph);
  if (!pending.length) return null;
  return (
    <Box borderStyle="single" borderColor="yellow" paddingX={1}>
      <Text color="yellow">Pending approval: {pending.join(" / ")}</Text>
    </Box>
  );
}

function pendingActions(graph: AgentGraphState): string[] {
  const actions: string[] = [];
  const selected = graph.candidates.find((candidate) => candidate.candidateId === graph.judge?.selectedCandidateId) ?? graph.candidates[0];
  if (graph.access.patchAllowed && !graph.approvals.patchApproved && selected?.unifiedDiff) actions.push("a apply patch");
  if (graph.access.shellAllowed && !graph.approvals.shellApproved && graph.changedFiles.length && graph.plan?.verificationCommands?.length) actions.push("t run shell");
  if (graph.access.patchAllowed && graph.changedFiles.length) actions.push("u undo");
  return actions;
}
