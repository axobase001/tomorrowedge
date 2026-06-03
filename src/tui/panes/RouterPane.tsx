import React from "react";
import { Box, Text } from "ink";
import type { RoutingPlan } from "../../core/routing/policies.js";
import type { AccessPolicy } from "../../core/permissions/accessPolicy.js";

export function RouterPane({ routing, access }: { routing: RoutingPlan; access?: AccessPolicy }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text bold>路由</Text>
      <Text>
        模式={routing.mode} 权限={access?.mode ?? "partial"} 隐私锁定={String(routing.privacyLocked)}
      </Text>
      {routing.assignments.map((assignment) => (
        <Text key={assignment.role} color="gray">
          {assignment.role}: {assignment.provider}/{assignment.model}
        </Text>
      ))}
    </Box>
  );
}
