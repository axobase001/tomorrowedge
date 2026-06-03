import React from "react";
import { Box, Text } from "ink";
import type { FinalSummary } from "../../schemas/evidence.js";

export function EvidencePane({ summary }: { summary?: FinalSummary }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text bold>证据</Text>
      <Text>结果={summary?.result ?? "--"}</Text>
      {(summary?.evidence ?? []).map((item) => (
        <Text key={item} color="green">
          {item}
        </Text>
      ))}
      {(summary?.risksRemaining ?? []).map((item) => (
        <Text key={item} color="yellow">
          风险：{item}
        </Text>
      ))}
    </Box>
  );
}
