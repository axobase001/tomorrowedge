import React from "react";
import { Box, Text } from "ink";
import type { AgentRunState } from "../../schemas/agentTask.js";
import { CostBadge } from "./CostBadge.js";
import { StatusBadge } from "./StatusBadge.js";

export function AgentCard({ agent }: { agent: AgentRunState }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1}>
      <Text>
        <Text bold>{roleLabel(agent.role)}</Text> <StatusBadge status={agent.status} /> <Text color="gray">{agent.provider}/{agent.model}</Text> <CostBadge costUsd={agent.costUsd} />
      </Text>
      <Text color="gray">{agent.summary}</Text>
    </Box>
  );
}

function roleLabel(role: AgentRunState["role"]): string {
  return {
    planner: "规划器",
    explorer: "探索器",
    coder_a: "编码器A",
    coder_b: "编码器B",
    reviewer: "审查器",
    judge: "裁决器",
    runner: "运行器",
    repairer: "修复器",
    summarizer: "总结器"
  }[role];
}
