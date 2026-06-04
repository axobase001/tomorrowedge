import React from "react";
import { Box, Text } from "ink";
import type { RunResult } from "../../schemas/evidence.js";

export function ShellPane({ commands, runResults = [], active = false }: { commands: string[]; runResults?: RunResult[]; active?: boolean }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={active ? "cyan" : "gray"} paddingX={1}>
      <Text bold>Shell</Text>
      {commands.length ? commands.map((command) => <Text key={command}>planned: {command}</Text>) : <Text color="gray">no planned command</Text>}
      {runResults.length ? (
        runResults.slice(-4).map((result, index) => (
          <Box key={`${result.command}-${index}`} flexDirection="column">
            <Text color={result.success ? "green" : "yellow"}>{result.command}: exit={result.exitCode} duration={result.durationMs}ms</Text>
            {result.stdout ? <Text color="gray">stdout: {oneLine(result.stdout)}</Text> : null}
            {result.stderr ? <Text color="yellow">stderr: {oneLine(result.stderr)}</Text> : null}
          </Box>
        ))
      ) : (
        <Text color="gray">no shell result yet</Text>
      )}
    </Box>
  );
}

function oneLine(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}
