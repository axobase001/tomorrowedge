import type { RunResult } from "../../schemas/evidence.js";

export function completionStatus(results: RunResult[]): "completed" | "partially_completed" | "failed" {
  if (!results.length) return "partially_completed";
  return results.every((result) => result.success) ? "completed" : "failed";
}
