import React from "react";
import { Box, Text } from "ink";
import type { AgentGraphState } from "../../core/agentGraph/state.js";

export function MemoryPane({ graph, active = false }: { graph: AgentGraphState; active?: boolean }) {
  const latestNotes = graph.modelNotes.slice(-2);
  const externalCost = summarizeExternalCost(graph);
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
      {externalCost.totalTokens || externalCost.estimatedCostUsd !== undefined ? (
        <Text color="cyan">
          external tokens={externalCost.totalTokens} external_cost={externalCost.estimatedCostUsd === undefined ? "unknown" : `$${externalCost.estimatedCostUsd.toFixed(6)}`}
        </Text>
      ) : null}
      {externalCost.byAgent.length ? (
        <Text color="gray">
          external agents: {externalCost.byAgent.map((item) => `${item.id}:${item.totalTokens}${item.cost === undefined ? "" : `/$${item.cost.toFixed(4)}`}`).join(" ")}
        </Text>
      ) : null}
      {graph.budgetStatus ? <Text color={graph.budgetStatus.status === "blocked" ? "yellow" : "gray"}>预算：{graph.budgetStatus.status}</Text> : null}
      {latestNotes.map((note) => (
        <Text key={note.id} color={note.error ? "yellow" : "cyan"}>
          {note.role}/{note.provider}: {note.error ?? note.content.slice(0, 80)}
        </Text>
      ))}
    </Box>
  );
}

function summarizeExternalCost(graph: AgentGraphState): { totalTokens: number; estimatedCostUsd?: number; byAgent: Array<{ id: string; totalTokens: number; cost?: number }> } {
  const byAgent = new Map<string, { id: string; totalTokens: number; cost?: number }>();
  let totalTokens = 0;
  let totalCost = 0;
  let hasCost = false;
  for (const event of graph.events) {
    if (event.type !== "external_agent_cost_usage") continue;
    const tokens = event.totalTokens ?? ((event.inputTokens ?? 0) + (event.outputTokens ?? 0));
    totalTokens += tokens;
    if (event.estimatedCostUsd !== undefined) {
      totalCost += event.estimatedCostUsd;
      hasCost = true;
    }
    const item = byAgent.get(event.externalAgentId) ?? { id: event.externalAgentId, totalTokens: 0 };
    item.totalTokens += tokens;
    if (event.estimatedCostUsd !== undefined) item.cost = (item.cost ?? 0) + event.estimatedCostUsd;
    byAgent.set(event.externalAgentId, item);
  }
  return { totalTokens, estimatedCostUsd: hasCost ? totalCost : undefined, byAgent: [...byAgent.values()] };
}
