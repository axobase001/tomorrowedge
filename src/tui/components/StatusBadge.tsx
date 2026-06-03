import React from "react";
import { Text } from "ink";
import type { AgentStatus } from "../../schemas/agentTask.js";

export function StatusBadge({ status }: { status: AgentStatus }) {
  const color =
    status === "success" ? "green" : status === "failed" ? "red" : status === "running" ? "cyan" : status === "waiting_for_user" ? "yellow" : "gray";
  return <Text color={color}>{statusLabel(status)}</Text>;
}

function statusLabel(status: AgentStatus): string {
  return {
    pending: "待处理",
    running: "运行中",
    success: "成功",
    failed: "失败",
    blocked: "阻塞",
    waiting_for_user: "等待授权"
  }[status];
}
