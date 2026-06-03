import React from "react";
import { Box, Text } from "ink";
import { renderDiffSummary } from "../../core/patch/diffRenderer.js";

export function DiffViewer({ diff }: { diff: string }) {
  const lines = diff ? diff.split(/\r?\n/).slice(0, 18) : ["未选择补丁。"];
  return (
    <Box flexDirection="column">
      <Text color="gray">{renderDiffSummary(diff)}</Text>
      {lines.map((line, index) => (
        <Text key={`${index}-${line.slice(0, 12)}`} color={line.startsWith("+") ? "green" : line.startsWith("-") ? "red" : "white"}>
          {line}
        </Text>
      ))}
    </Box>
  );
}
