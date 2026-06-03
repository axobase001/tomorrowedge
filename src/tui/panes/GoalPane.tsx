import React from "react";
import { Box, Text } from "ink";
import type { Plan } from "../../schemas/plan.js";

export function GoalPane({ goal, plan }: { goal: string; plan?: Plan }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text bold>目标</Text>
      <Text>{goal}</Text>
      <Text color="gray">类型={plan?.taskType ?? "--"} 风险={plan?.riskLevel ?? "--"}</Text>
      {(plan?.constraints ?? []).map((constraint) => (
        <Text key={constraint} color="yellow">约束：{constraint}</Text>
      ))}
    </Box>
  );
}
