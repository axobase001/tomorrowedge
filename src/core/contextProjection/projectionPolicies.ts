import type { RuntimeArtifactKind } from "./artifactView.js";

export type ProjectionPolicy = "tail" | "head_tail" | "structured" | "summary" | "full";

export function policyForArtifactKind(kind: RuntimeArtifactKind): ProjectionPolicy {
  if (kind === "stdout" || kind === "stderr") return "tail";
  if (kind === "diff") return "structured";
  if (kind === "file") return "head_tail";
  if (kind === "review" || kind === "judge" || kind === "json" || kind === "trace") return "summary";
  return "summary";
}
