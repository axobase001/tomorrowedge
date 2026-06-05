import type { EventArtifact } from "../events/eventTypes.js";

export type RuntimeArtifactKind = "stdout" | "stderr" | "diff" | "file" | "review" | "judge" | "trace" | "json";

export type RuntimeArtifact = {
  ref: string;
  kind: RuntimeArtifactKind;
  fullTextPath: string;
  bytes: number;
  content: string;
};

export function runtimeArtifactFromText(ref: string, kind: RuntimeArtifactKind, content: string): RuntimeArtifact {
  return {
    ref,
    kind,
    fullTextPath: ref,
    bytes: Buffer.byteLength(content, "utf8"),
    content
  };
}

export function runtimeArtifactFromEventArtifact(artifact: EventArtifact, kind: RuntimeArtifactKind): RuntimeArtifact {
  return runtimeArtifactFromText(artifact.ref, kind, artifact.content);
}
