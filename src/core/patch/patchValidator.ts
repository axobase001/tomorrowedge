import { realpathSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../../config/configLoader.js";
import { classifyFileRisk } from "../../safety/fileRisk.js";
import { createIgnoreMatcher, normalizePath } from "../../safety/ignoreRules.js";
import { log } from "../../utils/logger.js";
import { parseUnifiedDiff } from "./patchParser.js";

export type PatchValidationIssue = {
  path: string;
  reason: string;
};

export type PatchValidationResult = {
  ok: boolean;
  issues: PatchValidationIssue[];
  files: string[];
};

export function validateUnifiedDiff(cwd: string, unifiedDiff: string): PatchValidationResult {
  const config = loadConfig(cwd);
  const matcher = createIgnoreMatcher(cwd, config);
  const parsedFiles = parseUnifiedDiff(unifiedDiff);
  const files = parsedFiles
    .map((file) => normalizePath(file.newFileName || file.oldFileName))
    .filter(Boolean);
  const issues: PatchValidationIssue[] = [];

  for (const parsedFile of parsedFiles) {
    const filePath = normalizePath(parsedFile.newFileName || parsedFile.oldFileName);
    if (!filePath) continue;
    if (parsedFile.isBinary) {
      issues.push({ path: filePath, reason: "binary patches are not supported" });
      continue;
    }
    if (parsedFile.isRename) {
      issues.push({ path: filePath, reason: "rename patches require explicit manual handling" });
      continue;
    }
    if (isPathTraversal(cwd, filePath)) {
      issues.push({ path: filePath, reason: "path escapes project root" });
      continue;
    }
    if (matcher.ignores(filePath)) {
      issues.push({ path: filePath, reason: "path is ignored by safety or ignore rules" });
      continue;
    }
    const risk = classifyFileRisk(filePath, 0);
    if (risk === "sensitive") {
      issues.push({ path: filePath, reason: "path is classified as sensitive" });
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    files
  };
}

export function assertPatchSafe(cwd: string, unifiedDiff: string): string[] {
  const result = validateUnifiedDiff(cwd, unifiedDiff);
  if (!result.ok) {
    const detail = result.issues.map((issue) => `${issue.path}: ${issue.reason}`).join("; ");
    throw new Error(`Patch blocked by safety validation: ${detail}`);
  }
  return result.files;
}

function isPathTraversal(cwd: string, relativePath: string): boolean {
  const resolved = path.resolve(cwd, relativePath);
  const root = path.resolve(cwd);
  if (resolved === root) return false;
  if (!resolved.startsWith(root + path.sep)) return true;
  try {
    const realRoot = realpathSync(root);
    const parentDir = path.dirname(resolved);
    const realParent = realpathSync(parentDir);
    if (realParent !== realRoot && !realParent.startsWith(realRoot + path.sep)) return true;
    try {
      const realResolved = realpathSync(resolved);
      return realResolved !== realRoot && !realResolved.startsWith(realRoot + path.sep);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        log("warn", `Patch path realpath fallback for ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
      return false;
    }
  } catch (error) {
    log("warn", `Patch traversal check failed closed for ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    return true;
  }
}
