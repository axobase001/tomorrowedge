import React from "react";
import { Box, Text } from "ink";
import type { Plan } from "../../schemas/plan.js";

export function GoalPane({ goal, plan, active = false }: { goal: string; plan?: Plan; active?: boolean }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={active ? "cyan" : "gray"} paddingX={1}>
      <Text bold>目标</Text>
      <Text>{goal}</Text>
      <Text color="gray">类型={plan?.taskType ?? "--"} 风险={plan?.riskLevel ?? "--"}</Text>
      {(plan?.constraints ?? []).map((constraint) => (
        <Text key={constraint} color="yellow">约束：{constraint}</Text>
      ))}
    </Box>
  );
}
