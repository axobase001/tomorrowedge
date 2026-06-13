import { makeId } from "../../utils/ids.js";

export type StrategyGenome = {
  id: string;
  schemaVersion: "strategy-genome/v1";
  taskSplitStrategy: "coarse" | "balanced" | "fine";
  agentAssignmentStrategy:
    | "chief_led"
    | "cost_saver"
    | "quality_first"
    | "parallel_candidates"
    | "risk_averse";
  reviewStrictness: "light" | "normal" | "strict";
  debateDepth: 0 | 1 | 2 | 3;
  repairPolicy: "none" | "single_retry" | "bounded_retry" | "replan";
  budgetPolicy: "cheap_first" | "balanced" | "strong_for_decisions";
  councilPolicy: "none" | "on_high_risk" | "on_failure" | "always_for_large_tasks";
};

export function defaultStrategyGenome(): StrategyGenome {
  return {
    id: makeId("strategy"),
    schemaVersion: "strategy-genome/v1",
    taskSplitStrategy: "balanced",
    agentAssignmentStrategy: "chief_led",
    reviewStrictness: "normal",
    debateDepth: 1,
    repairPolicy: "bounded_retry",
    budgetPolicy: "strong_for_decisions",
    councilPolicy: "always_for_large_tasks"
  };
}
