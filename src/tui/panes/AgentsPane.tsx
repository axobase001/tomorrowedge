import React from "react";
import { Box, Text } from "ink";
import type { AgentRunState } from "../../schemas/agentTask.js";
import { AgentCard } from "../components/AgentCard.js";

export function AgentsPane({ agents }: { agents: AgentRunState[] }) {
  return (
    <Box flexDirection="column" width="50%">
      <Text bold>智能体</Text>
      {agents.map((agent) => (
        <AgentCard key={agent.id} agent={agent} />
      ))}
    </Box>
  );
}
