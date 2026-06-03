import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizePath } from "../../safety/ignoreRules.js";

export async function readProjectFile(cwd: string, relativePath: string): Promise<string> {
  const safePath = resolveInside(cwd, relativePath);
  return readFile(safePath, "utf8");
}

export function resolveInside(cwd: string, relativePath: string): string {
  const resolved = path.resolve(cwd, relativePath);
  const root = path.resolve(cwd);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`Path escapes project root: ${normalizePath(relativePath)}`);
  }
  return resolved;
}
