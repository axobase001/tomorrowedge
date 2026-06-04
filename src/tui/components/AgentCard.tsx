import React from "react";
import { Box, Text } from "ink";
import type { AgentRunState } from "../../schemas/agentTask.js";
import { CostBadge } from "./CostBadge.js";
import { StatusBadge } from "./StatusBadge.js";

export function AgentCard({ agent }: { agent: AgentRunState }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1}>
      <Text>
        <Text bold>{roleLabel(agent.role)}</Text> <StatusBadge status={agent.status} /> {agent.agentKind === "external" || agent.provider.startsWith("external:") ? <Text color="cyan">EXTERNAL </Text> : null}{agent.role === "runner" ? <Text color="yellow">{runnerKind(agent)} </Text> : null}<Text color="gray">{agent.provider}/{agent.model}</Text> <Text color="gray">{formatDuration(agent.elapsedMs)}</Text> <CostBadge costUsd={agent.costUsd} />
      </Text>
      <Text color="gray">{agent.summary}</Text>
    </Box>
  );
}

function runnerKind(agent: AgentRunState): string {
  if (/patch/i.test(agent.model) || /patch/i.test(agent.summary)) return "PATCH-RUNNER";
  if (/shell|test|command/i.test(agent.model) || /shell|test|command/i.test(agent.summary)) return "SHELL-RUNNER";
  return "RUNNER";
}

function formatDuration(ms?: number): string {
  if (ms === undefined) return "";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function roleLabel(role: AgentRunState["role"]): string {
  return {
    core: "Core",
    vision: "视觉",
    planner: "规划",
    explorer: "探索",
    coder_a: "编码 A",
    coder_b: "编码 B",
    reviewer: "审查",
    judge: "裁决",
    runner: "运行",
    repairer: "修复",
    summarizer: "总结"
  }[role];
}
