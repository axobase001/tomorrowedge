import React from "react";
import { Box, Text } from "ink";
import type { Plan } from "../../schemas/plan.js";
import type { ConversationTarget } from "../../schemas/conversation.js";

export function GoalPane({ goal, plan, conversationTarget, active = false }: { goal: string; plan?: Plan; conversationTarget?: ConversationTarget; active?: boolean }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={active ? "cyan" : "gray"} paddingX={1}>
      <Text bold>Goal / Target</Text>
      <Text color="cyan">Talk to: {conversationTarget ? `${conversationTarget.id} / ${conversationTarget.label}` : "core / TomorrowEdge Core"}</Text>
      <Text>{goal}</Text>
      <Text color="gray">type={plan?.taskType ?? "--"} risk={plan?.riskLevel ?? "--"}</Text>
      {(plan?.constraints ?? []).map((constraint) => (
        <Text key={constraint} color="yellow">constraint: {constraint}</Text>
      ))}
    </Box>
  );
}
