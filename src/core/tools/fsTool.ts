import { existsSync, realpathSync } from "node:fs";
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
  if (!isInside(root, resolved) || escapesRealProjectRoot(root, resolved)) {
    throw new Error(`Path escapes project root: ${normalizePath(relativePath)}`);
  }
  return resolved;
}

function escapesRealProjectRoot(root: string, resolved: string): boolean {
  const realRoot = realpathSync(root);
  const parent = path.dirname(resolved);
  const realParent = realpathSync(nearestExistingAncestor(root, parent));
  if (!isInside(realRoot, realParent)) return true;
  if (!existsSync(resolved)) return false;
  return !isInside(realRoot, realpathSync(resolved));
}

function nearestExistingAncestor(root: string, start: string): string {
  let current = path.resolve(start);
  while (isInside(root, current)) {
    if (existsSync(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return root;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative));
}
