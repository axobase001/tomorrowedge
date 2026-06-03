import React from "react";
import { Text } from "ink";

export function CostBadge({ costUsd }: { costUsd?: number }) {
  return <Text color="gray">{costUsd === undefined ? "$--" : `$${costUsd.toFixed(4)}`}</Text>;
}
