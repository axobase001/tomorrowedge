import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { applyPatch, parsePatch, type StructuredPatch } from "diff";
import { loadConfig } from "../../config/configLoader.js";
import { classifyFileRisk } from "../../safety/fileRisk.js";
import { createIgnoreMatcher, normalizePath } from "../../safety/ignoreRules.js";
import { log } from "../../utils/logger.js";
import { parseUnifiedDiff, stripPrefix } from "./patchParser.js";

export type PatchValidationIssue = {
  path: string;
  reason: string;
  category?: "safety" | "artifact_quality";
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
  const parsedPatches = safeParsePatch(unifiedDiff);
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
      issues.push({ path: filePath, reason: textQualityIssue, category: "artifact_quality" });
      continue;
    }
    const patch = parsedPatches.find((item) => normalizePath(stripPrefix(item.newFileName ?? item.oldFileName ?? "")) === filePath);
    const artifactIssues = patch ? artifactQualityIssuesForPatch(cwd, filePath, patch) : [];
    if (artifactIssues.length) {
      issues.push(...artifactIssues.map((reason) => ({ path: filePath, reason, category: "artifact_quality" as const })));
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
  if (looksLikePlaceholderTodo(addedText)) {
    return "added text contains unresolved TODO/FIXME/TBD placeholder text";
  }
  return undefined;
}

function artifactQualityIssuesForPatch(cwd: string, filePath: string, patch: StructuredPatch): string[] {
  const issues: string[] = [];
  const original = readExistingText(cwd, filePath);
  const addedText = addedTextFromPatch(patch);
  const removedText = removedTextFromPatch(patch);
  issues.push(...duplicateDeclarationIssues(original, addedText, removedText));

  const next = previewPatchedText(original, patch) ?? `${original}\n${addedText}`;
  issues.push(...artifactQualityIssuesForText(filePath, next));
  return uniqueStrings(issues);
}

export function artifactQualityIssuesForText(filePath: string, content: string): string[] {
  const issues: string[] = [];
  if (!content.trim()) return issues;
  if (looksLikeMojibake(content)) issues.push("artifact text appears to contain mojibake; regenerate valid UTF-8 output");
  if (looksLikePlaceholderTodo(content)) issues.push("artifact contains unresolved TODO/FIXME/TBD placeholder text");
  issues.push(...duplicateTopLevelDeclarationIssues(content));
  if (/README(?:\.[\w-]+)?\.md$/i.test(filePath)) {
    issues.push(...duplicateMarkdownHeadingIssues(content));
  }
  return uniqueStrings(issues);
}

function duplicateDeclarationIssues(original: string, addedText: string, removedText: string): string[] {
  if (!addedText.trim()) return [];
  const removedNames = new Set(topLevelDeclarations(removedText).map((item) => item.name));
  const existingNames = new Set(topLevelDeclarations(original).map((item) => item.name));
  const addedDeclarations = topLevelDeclarations(addedText);
  const issues: string[] = [];
  const addedCounts = countBy(addedDeclarations.map((item) => item.name));
  for (const declaration of addedDeclarations) {
    if ((addedCounts.get(declaration.name) ?? 0) > 1) {
      issues.push(`patch adds duplicate top-level declaration ${declaration.name}`);
      continue;
    }
    if (existingNames.has(declaration.name) && !removedNames.has(declaration.name)) {
      issues.push(`patch adds duplicate top-level declaration ${declaration.name} without replacing the existing implementation`);
    }
  }
  return issues;
}

function duplicateTopLevelDeclarationIssues(content: string): string[] {
  const declarations = topLevelDeclarations(content);
  const counts = countBy(declarations.map((item) => item.name));
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => `artifact contains duplicate top-level declaration ${name}`);
}

function duplicateMarkdownHeadingIssues(content: string): string[] {
  const headings = content
    .split(/\r?\n/)
    .map((line) => line.match(/^(#{1,3})\s+(.+?)\s*$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => `${match[1]} ${match[2].trim().toLowerCase()}`);
  const counts = countBy(headings);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([heading]) => `README contains duplicate heading "${heading}"`);
}

type Declaration = { name: string; exported: boolean };

function topLevelDeclarations(text: string): Declaration[] {
  const declarations: Declaration[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const leadingWhitespace = rawLine.match(/^\s*/)?.[0].length ?? 0;
    const line = rawLine.trimStart();
    if (!line || (leadingWhitespace > 0 && !line.startsWith("export "))) continue;
    const match = line.match(/^(export\s+)?(?:(?:async\s+)?function|class)\s+([A-Za-z_$][\w$]*)\b/)
      ?? line.match(/^(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/);
    if (!match) continue;
    declarations.push({ name: match[2]!, exported: Boolean(match[1]) });
  }
  return declarations;
}

function readExistingText(cwd: string, filePath: string): string {
  const absolute = path.resolve(cwd, filePath);
  if (!existsSync(absolute)) return "";
  try {
    return readFileSync(absolute, "utf8");
  } catch {
    return "";
  }
}

function safeParsePatch(unifiedDiff: string): ReturnType<typeof parsePatch> {
  try {
    return parsePatch(unifiedDiff);
  } catch {
    return [];
  }
}

function previewPatchedText(original: string, patch: StructuredPatch): string | undefined {
  const next = applyPatch(original, patch);
  return next === false ? undefined : next;
}

function removedTextFromPatch(patch: ReturnType<typeof parsePatch>[number]): string {
  return patch.hunks
    .flatMap((hunk) => hunk.lines)
    .filter((line) => line.startsWith("-") && !line.startsWith("---"))
    .map((line) => line.slice(1))
    .join("\n");
}

function looksLikePlaceholderTodo(text: string): boolean {
  return /\b(?:TODO|FIXME|TBD|XXX)\b|待办|占位/.test(text);
}

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()).map((value) => value.trim()))];
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
