import React from "react";
import { Box, Text } from "ink";
import type { AgentGraphState } from "../../core/agentGraph/state.js";

export type PaletteMode = "commands" | "access" | "models";

export function CommandPalette({ mode, graph, selectedRouteIndex = 0 }: { mode: PaletteMode; graph: AgentGraphState; selectedRouteIndex?: number }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>{titleFor(mode)}</Text>
      {mode === "commands" ? <CommandItems /> : null}
      {mode === "access" ? <AccessItems graph={graph} /> : null}
      {mode === "models" ? <ModelItems graph={graph} selectedRouteIndex={selectedRouteIndex} /> : null}
      <Text color="gray">Enter/Esc close</Text>
    </Box>
  );
}

function CommandItems() {
  return (
    <>
      <Text><Text color="cyan">Tab</Text> switch focused pane</Text>
      <Text><Text color="cyan">a</Text> approve and apply selected patch</Text>
      <Text><Text color="cyan">t</Text> approve planned shell command</Text>
      <Text><Text color="cyan">u</Text> undo latest patch snapshot</Text>
      <Text><Text color="cyan">p</Text> show access mode</Text>
      <Text><Text color="cyan">m</Text> show model route preview</Text>
    </>
  );
}

function AccessItems({ graph }: { graph: AgentGraphState }) {
  return (
    <>
      <Text>Current: {graph.access.mode}</Text>
      <Text color="gray">restricted: blocks cloud/model calls and mutations</Text>
      <Text color="gray">partial: model calls allowed; patch/shell/repair require approval</Text>
      <Text color="gray">full: patch/shell/repair auto-approved and logged</Text>
      <Text color="yellow">Persist mode: tedge mode restricted|partial|full</Text>
    </>
  );
}

function ModelItems({ graph, selectedRouteIndex }: { graph: AgentGraphState; selectedRouteIndex: number }) {
  return (
    <>
      <Text>Routing mode: {graph.routing.mode}</Text>
      <Text color="gray">Number keys select a role; +/- previews provider/model changes.</Text>
      {graph.routing.assignments.slice(0, 9).map((assignment, index) => (
        <Text key={assignment.role} color={index === selectedRouteIndex ? "cyan" : "gray"}>
          {index + 1}. {assignment.role}: {assignment.provider}/{assignment.model}
        </Text>
      ))}
      <Text color="yellow">Persist preview: edit .tomorrowedge/config.yaml agents role provider/model, or run tedge models --configure-free --free-first.</Text>
    </>
  );
}

function titleFor(mode: PaletteMode): string {
  if (mode === "access") return "Access mode";
  if (mode === "models") return "Model routing";
  return "Commands";
}
