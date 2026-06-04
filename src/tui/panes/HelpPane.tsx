import React from "react";
import { Box, Text } from "ink";
import { keybindings } from "../state/keybindings.js";

export function HelpPane({ active = false }: { active?: boolean }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={active ? "cyan" : "gray"} paddingX={1}>
      <Text bold>Help</Text>
      {keybindings.map(([key, label]) => (
        <Text key={key}>
          <Text color="cyan">{key}</Text> {label}
        </Text>
      ))}
      <Text color="gray">mode: tedge mode restricted|partial|full</Text>
      <Text color="gray">target: tedge targets / tedge ask --to reviewer "..." / tedge run --to debate "..."</Text>
    </Box>
  );
}
