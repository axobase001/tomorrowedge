import React from "react";
import { Box, Text } from "ink";
import type { RoutingPlan } from "../../core/routing/policies.js";
import type { AccessPolicy } from "../../core/permissions/accessPolicy.js";
import type { CapabilityRoute } from "../../schemas/capabilityRoute.js";

export function RouterPane({ routing, access, capabilityRoute, active = false }: { routing: RoutingPlan; access?: AccessPolicy; capabilityRoute?: CapabilityRoute; active?: boolean }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={active ? "cyan" : "gray"} paddingX={1}>
      <Text bold>Routing</Text>
      {access ? <Text color={access.mode === "full" ? "green" : access.mode === "restricted" ? "yellow" : "cyan"}>{modeBadge(access.mode)}</Text> : null}
      <Text>
        mode={routing.mode} access={access?.mode ?? "partial"} privacyLocked={String(routing.privacyLocked)}
      </Text>
      {capabilityRoute ? <Text color="cyan">Capability stitching: {capabilityRoute.inputTypes.join(", ")} -&gt; Visual Spec -&gt; Code</Text> : null}
      {routing.assignments.map((assignment) => (
        <Text key={assignment.role} color="gray">
          {assignment.role}: {assignment.provider}/{assignment.model}
        </Text>
      ))}
    </Box>
  );
}

function modeBadge(mode: AccessPolicy["mode"]): string {
  if (mode === "full") return "MODE: FULL AUTONOMY - every step is visible and logged.";
  if (mode === "restricted") return "MODE: RESTRICTED - offline/read-only.";
  return "MODE: PARTIAL SUPERVISION - patch/shell/repair require approval.";
}
