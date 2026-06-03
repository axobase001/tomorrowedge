import React from "react";
import { Box, Text } from "ink";
import { keybindings } from "../state/keybindings.js";

export function HelpPane({ active = false }: { active?: boolean }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={active ? "cyan" : "gray"} paddingX={1}>
      <Text bold>帮助</Text>
      {keybindings.map(([key, label]) => (
        <Text key={key}>
          <Text color="cyan">{key}</Text> {label}
        </Text>
      ))}
      <Text color="gray">模式：tedge mode restricted|partial|full</Text>
    </Box>
  );
}
