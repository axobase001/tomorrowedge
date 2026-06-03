import path from "node:path";

export type FileRisk = "safe" | "sensitive" | "large" | "ignored";

export function classifyFileRisk(relativePath: string, sizeBytes: number): FileRisk {
  const name = path.basename(relativePath).toLowerCase();
  if (sizeBytes > 500_000) return "large";
  if (
    name.startsWith(".env") ||
    name.endsWith(".pem") ||
    name.endsWith(".key") ||
    name.endsWith(".sqlite") ||
    name.endsWith(".db") ||
    /credential|secret|token|password/i.test(relativePath)
  ) {
    return "sensitive";
  }
  return "safe";
}
