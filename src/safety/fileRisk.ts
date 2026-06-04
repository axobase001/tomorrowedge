import path from "node:path";

export type FileRisk = "safe" | "sensitive" | "large" | "binary" | "ignored";

const binaryExtensions = new Set([
  ".7z",
  ".avif",
  ".bmp",
  ".class",
  ".dll",
  ".dmg",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp3",
  ".mp4",
  ".pdf",
  ".png",
  ".pyc",
  ".so",
  ".tar",
  ".tgz",
  ".webp",
  ".woff",
  ".woff2",
  ".zip"
]);

export function classifyFileRisk(relativePath: string, sizeBytes: number): FileRisk {
  const name = path.basename(relativePath).toLowerCase();
  if (isBinaryLikePath(relativePath)) return "binary";
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

export function isBinaryLikePath(relativePath: string): boolean {
  return binaryExtensions.has(path.extname(relativePath).toLowerCase());
}
