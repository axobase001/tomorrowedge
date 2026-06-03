import React from "react";
import { Box, Text } from "ink";

export function ShellPane({ commands }: { commands: string[] }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text bold>Shell</Text>
      {commands.length ? commands.map((command) => <Text key={command}>拟运行：{command}</Text>) : <Text color="gray">尚未授权或运行命令。</Text>}
    </Box>
  );
}
