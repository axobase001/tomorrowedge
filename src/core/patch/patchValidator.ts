import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { parsePatch } from "diff";
import { loadConfig } from "../../config/configLoader.js";
import { classifyFileRisk } from "../../safety/fileRisk.js";
import { createIgnoreMatcher, normalizePath } from "../../safety/ignoreRules.js";
import { log } from "../../utils/logger.js";
import { parseUnifiedDiff, stripPrefix } from "./patchParser.js";

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
    const textQualityIssue = textQualityIssueForPatch(unifiedDiff, filePath);
    if (textQualityIssue) {
      issues.push({ path: filePath, reason: textQualityIssue });
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
  if (!isInside(root, resolved)) return true;
  try {
    const realRoot = realpathSync(root);
    const realParent = realpathSync(nearestExistingAncestor(root, path.dirname(resolved)));
    if (!isInside(realRoot, realParent)) return true;
    try {
      const realResolved = realpathSync(resolved);
      return !isInside(realRoot, realResolved);
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

export function textQualityIssueForUnifiedDiff(unifiedDiff: string): string | undefined {
  const patches = parsePatch(unifiedDiff);
  for (const patch of patches) {
    const filePath = normalizePath(stripPrefix(patch.newFileName ?? patch.oldFileName ?? ""));
    if (!filePath) continue;
    const issue = textQualityIssueForAddedText(addedTextFromPatch(patch), filePath);
    if (issue) return `${filePath}: ${issue}`;
  }
  return undefined;
}

function textQualityIssueForPatch(unifiedDiff: string, filePath: string): string | undefined {
  const addedText = addedTextForFile(unifiedDiff, filePath);
  return textQualityIssueForAddedText(addedText, filePath);
}

function textQualityIssueForAddedText(addedText: string, filePath: string): string | undefined {
  if (!addedText.trim()) return undefined;
  if (/\.(?:html?|xhtml)$/i.test(filePath) && /\?\/(?:p|strong|em|h[1-6]|div|span|body|html)>/i.test(addedText)) {
    return "added HTML appears to contain malformed closing tags";
  }
  if (looksLikeMojibake(addedText)) {
    return "added text appears to contain mojibake; regenerate valid UTF-8 output";
  }
  return undefined;
}

function addedTextForFile(unifiedDiff: string, filePath: string): string {
  const patches = parsePatch(unifiedDiff);
  const normalizedTarget = normalizePath(filePath);
  for (const patch of patches) {
    const target = normalizePath(stripPrefix(patch.newFileName ?? patch.oldFileName ?? ""));
    if (target !== normalizedTarget) continue;
    return patch.hunks
      .flatMap((hunk) => hunk.lines)
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .map((line) => line.slice(1))
      .join("\n");
  }
  return "";
}

function addedTextFromPatch(patch: ReturnType<typeof parsePatch>[number]): string {
  return patch.hunks
    .flatMap((hunk) => hunk.lines)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
}

export function looksLikeMojibake(text: string): boolean {
  if (text.includes("\uFFFD") || text.includes("锟斤拷")) return true;
  const markers = ["鏄", "涓", "鐨", "鎴", "鍥", "绋", "甯", "杈", "紭", "璇", "鎬", "寤", "銆", "锛", "鏁", "鐭", "鏍", "閺", "閻", "閹", "娑", "缁", "绱", "鐠", "瀵", "閵", "閿", "顩", "绨", "粙", "瀣", "碍", "搴", "嫯", "鐦", "毉", "滈"];
  const hits = markers.reduce((sum, marker) => sum + countOccurrences(text, marker), 0);
  const cjkCount = [...text].filter((char) => /[\u3400-\u9fff]/u.test(char)).length;
  const danglingQuestionMarks = (text.match(/[\u3400-\u9fff]\?/gu) ?? []).length;
  return danglingQuestionMarks >= 2 || (hits >= 3 && hits / Math.max(cjkCount, 1) > 0.08);
}

function countOccurrences(text: string, marker: string): number {
  let count = 0;
  let index = text.indexOf(marker);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(marker, index + marker.length);
  }
  return count;
}
