import React from "react";
import { Box, Text } from "ink";

export function ApprovalPrompt({ safeMode }: { safeMode: boolean }) {
  return (
    <Box borderStyle="single" borderColor="yellow" paddingX={1}>
      <Text color="yellow">{safeMode ? "安全模式：应用补丁和执行 shell 命令都需要显式授权。" : "安全模式已关闭。"}</Text>
    </Box>
  );
}
