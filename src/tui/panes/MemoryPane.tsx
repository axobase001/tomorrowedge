import React from "react";
import { Box, Text } from "ink";
import type { AgentGraphState } from "../../core/agentGraph/state.js";

export function MemoryPane({ graph, active = false }: { graph: AgentGraphState; active?: boolean }) {
  const latestNotes = graph.modelNotes.slice(-2);
  const costText =
    graph.usageSummary.estimatedCostUsd === undefined ? "成本=未配置价格" : `成本=$${graph.usageSummary.estimatedCostUsd.toFixed(6)}`;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={active ? "cyan" : "gray"} paddingX={1}>
      <Text bold>记忆</Text>
      <Text color="gray">目标：{graph.goal}</Text>
      <Text color="gray">候选数量：{graph.candidates.length}</Text>
      <Text color="gray">裁决：{graph.judge?.decision ?? "待定"}</Text>
      <Text color="gray">
        tokens={graph.usageSummary.totalTokens} {costText}
      </Text>
      {graph.budgetStatus ? <Text color={graph.budgetStatus.status === "blocked" ? "yellow" : "gray"}>预算：{graph.budgetStatus.status}</Text> : null}
      {latestNotes.map((note) => (
        <Text key={note.id} color={note.error ? "yellow" : "cyan"}>
          {note.role}/{note.provider}: {note.error ?? note.content.slice(0, 80)}
        </Text>
      ))}
    </Box>
  );
}
