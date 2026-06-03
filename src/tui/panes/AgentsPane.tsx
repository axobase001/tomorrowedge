import React from "react";
import { Box, Text } from "ink";
import type { AgentRunState } from "../../schemas/agentTask.js";
import { AgentCard } from "../components/AgentCard.js";

export function AgentsPane({ agents, active = false }: { agents: AgentRunState[]; active?: boolean }) {
  return (
    <Box flexDirection="column" width="50%">
      <Text bold color={active ? "cyan" : undefined}>智能体</Text>
      {agents.map((agent, index) => (
        <AgentCard key={`${agent.id}-${agent.startedAt ?? "pending"}-${index}`} agent={agent} />
      ))}
    </Box>
  );
}
