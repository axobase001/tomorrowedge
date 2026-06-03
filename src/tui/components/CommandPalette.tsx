import React from "react";
import { Box, Text } from "ink";
import type { AgentGraphState } from "../../core/agentGraph/state.js";

export type PaletteMode = "commands" | "access" | "models";

export function CommandPalette({ mode, graph }: { mode: PaletteMode; graph: AgentGraphState }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>{titleFor(mode)}</Text>
      {mode === "commands" ? <CommandItems /> : null}
      {mode === "access" ? <AccessItems graph={graph} /> : null}
      {mode === "models" ? <ModelItems graph={graph} /> : null}
      <Text color="gray">Enter/Esc 关闭</Text>
    </Box>
  );
}

function CommandItems() {
  return (
    <>
      <Text><Text color="cyan">a</Text> 授权并应用当前裁决补丁</Text>
      <Text><Text color="cyan">t</Text> 授权运行计划中的测试命令</Text>
      <Text><Text color="cyan">u</Text> 回滚最近一次补丁快照</Text>
      <Text><Text color="cyan">p</Text> 查看权限模式</Text>
      <Text><Text color="cyan">m</Text> 查看模型路由</Text>
    </>
  );
}

function AccessItems({ graph }: { graph: AgentGraphState }) {
  return (
    <>
      <Text>当前：{graph.access.mode}</Text>
      <Text color="gray">restricted：禁止云模型与本地变更</Text>
      <Text color="gray">partial：允许模型调用，patch/shell/repair 需授权</Text>
      <Text color="gray">full：自动批准 patch/shell/repair</Text>
      <Text color="yellow">持久切换：tedge mode restricted|partial|full</Text>
    </>
  );
}

function ModelItems({ graph }: { graph: AgentGraphState }) {
  return (
    <>
      <Text>路由模式：{graph.routing.mode}</Text>
      {graph.routing.assignments.slice(0, 8).map((assignment) => (
        <Text key={assignment.role} color="gray">
          {assignment.role}: {assignment.provider}/{assignment.model}
        </Text>
      ))}
      <Text color="yellow">偏好切换：tedge prefs --routing-mode balanced|quality|cheap|privacy</Text>
    </>
  );
}

function titleFor(mode: PaletteMode): string {
  if (mode === "access") return "权限模式";
  if (mode === "models") return "模型/路由";
  return "命令面板";
}
