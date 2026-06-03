import React from "react";
import { Box, Text } from "ink";

export function ShellPane({ commands, active = false }: { commands: string[]; active?: boolean }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={active ? "cyan" : "gray"} paddingX={1}>
      <Text bold>Shell</Text>
      {commands.length ? commands.map((command) => <Text key={command}>拟运行：{command}</Text>) : <Text color="gray">尚未授权或运行命令。</Text>}
    </Box>
  );
}
