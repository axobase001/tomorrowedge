import React from "react";
import { Box, Text } from "ink";
import type { TomorrowEdgeEvent } from "../../core/events/eventTypes.js";
import { renderEventLine } from "../../core/events/eventRenderer.js";

export function TracePane({ events, active = false }: { events: TomorrowEdgeEvent[]; active?: boolean }) {
  const latest = events.slice(-8);
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={active ? "cyan" : "gray"} paddingX={1}>
      <Text bold>Trace</Text>
      {latest.length ? (
        latest.map((event) => (
          <Text key={event.id} color={event.type === "autonomy_limit_reached" || event.type === "provider_fallback" ? "yellow" : "gray"}>
            {renderEventLine(event)}
          </Text>
        ))
      ) : (
        <Text color="gray">No events yet.</Text>
      )}
    </Box>
  );
}
