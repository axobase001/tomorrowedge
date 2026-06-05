import { reduceDiff } from "./reducers/diffReducer.js";
import { reduceFile } from "./reducers/fileReducer.js";
import { reduceJson } from "./reducers/jsonReducer.js";
import { reduceStderr } from "./reducers/stderrReducer.js";
import { reduceStdout } from "./reducers/stdoutReducer.js";
import { reduceTestLog } from "./reducers/testLogReducer.js";
import { policyForArtifactKind, type ProjectionPolicy } from "./projectionPolicies.js";
import type { RuntimeArtifact } from "./artifactView.js";

export type ProviderView = {
  artifactRef: string;
  preview: string;
  omittedBytes?: number;
  tokenEstimate?: number;
  handle: string;
  policy: ProjectionPolicy;
};

export function projectRuntimeArtifact(artifact: RuntimeArtifact, policy = policyForArtifactKind(artifact.kind)): ProviderView {
  const preview = reduceByPolicy(artifact.content, artifact.kind, policy);
  const previewBytes = Buffer.byteLength(preview, "utf8");
  return {
    artifactRef: artifact.ref,
    preview,
    omittedBytes: Math.max(0, artifact.bytes - previewBytes),
    tokenEstimate: estimateTokens(preview),
    handle: `${artifact.kind}:${artifact.ref}`,
    policy
  };
}

export function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function reduceByPolicy(text: string, kind: RuntimeArtifact["kind"], policy: ProjectionPolicy): string {
  if (policy === "full") return text;
  if (kind === "diff") return reduceDiff(text);
  if (kind === "stderr") return reduceStderr(text);
  if (kind === "stdout") return reduceStdout(text);
  if (kind === "file") return reduceFile(text);
  if (kind === "json" || kind === "review" || kind === "judge" || kind === "trace") return reduceJson(text);
  return reduceTestLog(text);
}
