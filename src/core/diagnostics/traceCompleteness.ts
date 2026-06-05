import type { TomorrowEdgeEvent } from "../events/eventTypes.js";

export type TraceCompleteness = {
  score: number;
  missing: string[];
};

const REQUIRED: Array<{ label: string; types: TomorrowEdgeEvent["type"][] }> = [
  { label: "plan recorded", types: ["evidence_update"] },
  { label: "context recorded", types: ["context_select"] },
  { label: "candidate patch recorded", types: ["patch_candidate"] },
  { label: "review recorded", types: ["review_decision"] },
  { label: "judge decision recorded", types: ["judge_decision"] },
  { label: "patch apply recorded", types: ["patch_apply"] },
  { label: "shell run recorded", types: ["shell_run"] },
  { label: "cost recorded", types: ["cost_usage", "budget_decision"] },
  { label: "artifacts linked", types: ["artifact_projection"] },
  { label: "stop reason recorded", types: ["workflow_stop_reason"] }
];

export function computeTraceCompleteness(events: TomorrowEdgeEvent[]): TraceCompleteness {
  const presentTypes = new Set(events.map((event) => event.type));
  const missing = REQUIRED.filter((item) => !item.types.some((type) => presentTypes.has(type))).map((item) => item.label);
  return {
    score: Math.round(((REQUIRED.length - missing.length) / REQUIRED.length) * 100),
    missing
  };
}
