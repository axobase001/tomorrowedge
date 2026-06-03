import React from "react";
import { Box, Text } from "ink";
import type { RoutingPlan } from "../../core/routing/policies.js";
import type { AccessPolicy } from "../../core/permissions/accessPolicy.js";
import type { CapabilityRoute } from "../../schemas/capabilityRoute.js";

export function RouterPane({ routing, access, capabilityRoute, active = false }: { routing: RoutingPlan; access?: AccessPolicy; capabilityRoute?: CapabilityRoute; active?: boolean }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={active ? "cyan" : "gray"} paddingX={1}>
      <Text bold>路由</Text>
      <Text>
        模式={routing.mode} 权限={access?.mode ?? "partial"} 隐私锁定={String(routing.privacyLocked)}
      </Text>
      {capabilityRoute ? <Text color="cyan">能力拼接：{capabilityRoute.inputTypes.join(", ")} -&gt; Visual Spec -&gt; Code</Text> : null}
      {routing.assignments.map((assignment) => (
        <Text key={assignment.role} color="gray">
          {assignment.role}: {assignment.provider}/{assignment.model}
        </Text>
      ))}
    </Box>
  );
}
