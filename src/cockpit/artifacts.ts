import path from "node:path";

export function safeArtifactPath(sessionDir: string, ref: string): string | undefined {
  if (ref.includes("..") || path.isAbsolute(ref)) return undefined;
  const resolved = path.resolve(sessionDir, ref);
  const relative = path.relative(sessionDir, resolved);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? resolved : undefined;
}
