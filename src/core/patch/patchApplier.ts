import { applyPatch, parsePatch, type StructuredPatch } from "diff";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseUnifiedDiff } from "./patchParser.js";
import { normalizeUnifiedDiffHunkCounts } from "./patchParser.js";
import { createUndoSnapshot } from "./undoManager.js";
import { resolveInside } from "../tools/fsTool.js";
import { assertPatchSafe } from "./patchValidator.js";

export type PatchApplyResult = {
  changedFiles: string[];
  undoSnapshotIds: string[];
};

export async function applyUnifiedDiff(cwd: string, unifiedDiff: string, approved: boolean): Promise<string[]> {
  const result = await applyUnifiedDiffWithResult(cwd, unifiedDiff, approved);
  return result.changedFiles;
}

export async function applyUnifiedDiffWithResult(cwd: string, unifiedDiff: string, approved: boolean): Promise<PatchApplyResult> {
  if (!approved) throw new Error("Patch application blocked: approval required.");
  const normalizedDiff = normalizeUnifiedDiffHunkCounts(unifiedDiff);
  assertPatchSafe(cwd, normalizedDiff);
  const files = parseUnifiedDiff(normalizedDiff);
  const parsedPatches = parsePatch(normalizedDiff);
  if (!files.length || !parsedPatches.length) {
    throw new Error("Patch application failed: no parseable unified diff files.");
  }
  if (files.length !== parsedPatches.length) {
    throw new Error(`Patch application failed: parsed file count mismatch (${files.length} target(s), ${parsedPatches.length} patch(es)).`);
  }
  const changed: string[] = [];
  const undoSnapshotIds: string[] = [];
  const plans: Array<{ target: string; absolute: string; original: string; existed: boolean; next: string; isDelete: boolean }> = [];
  for (const [index, file] of files.entries()) {
    const target = file.isDelete ? file.oldFileName : file.newFileName || file.oldFileName;
    if (!target) {
      throw new Error("Patch application failed: unified diff file target is missing.");
    }
    const absolute = resolveInside(cwd, target);
    const existed = await stat(absolute).then((value) => value.isFile()).catch(() => false);
    const original = existed ? await readFile(absolute, "utf8") : "";
    const exactNext = applyPatch(original, parsedPatches[index]);
    const fuzzyNext = exactNext === false ? applyPatch(original, parsedPatches[index], { fuzzFactor: 2 }) : exactNext;
    const deletionAnchoredNext = fuzzyNext === false ? applyUniqueDeletionAnchoredPatch(original, parsedPatches[index]) : fuzzyNext;
    const next = deletionAnchoredNext === false ? applyUniqueChangedSubstringPatch(original, parsedPatches[index]) : deletionAnchoredNext;
    if (next === false) {
      throw new Error(`Failed to apply patch for ${target}`);
    }
    plans.push({ target, absolute, original, existed, next, isDelete: file.isDelete });
  }
  const applied: typeof plans = [];
  try {
    for (const plan of plans) {
      await mkdir(path.dirname(plan.absolute), { recursive: true });
      undoSnapshotIds.push(await createUndoSnapshot(cwd, plan.target, plan.original));
      if (plan.isDelete) {
        await rm(plan.absolute, { force: true });
      } else {
        await writeFile(plan.absolute, plan.next, "utf8");
      }
      applied.push(plan);
      changed.push(plan.target);
    }
  } catch (error) {
    await rollbackAppliedPlans(applied);
    throw error;
  }
  return { changedFiles: changed, undoSnapshotIds };
}

function applyUniqueDeletionAnchoredPatch(original: string, patch: StructuredPatch): string | false {
  let next = original;
  for (const hunk of patch.hunks) {
    const removedLines = hunk.lines.filter((line) => line.startsWith("-")).map((line) => line.slice(1));
    const addedLines = hunk.lines.filter((line) => line.startsWith("+")).map((line) => line.slice(1));
    if (!removedLines.length) return false;
    const lines = next.split("\n");
    const matches: number[] = [];
    for (let index = 0; index <= lines.length - removedLines.length; index += 1) {
      if (removedLines.every((line, offset) => lines[index + offset] === line)) {
        matches.push(index);
      }
    }
    if (matches.length !== 1) return false;
    lines.splice(matches[0], removedLines.length, ...addedLines);
    next = lines.join("\n");
  }
  return next;
}

function applyUniqueChangedSubstringPatch(original: string, patch: StructuredPatch): string | false {
  let next = original;
  for (const hunk of patch.hunks) {
    const removedLines = hunk.lines.filter((line) => line.startsWith("-")).map((line) => line.slice(1));
    const addedLines = hunk.lines.filter((line) => line.startsWith("+")).map((line) => line.slice(1));
    if (removedLines.length !== 1 || addedLines.length !== 1) return false;
    const replacement = changedSubstring(removedLines[0], addedLines[0]);
    if (!replacement) return false;
    const matches = countOccurrences(next, replacement.oldText);
    if (matches !== 1) return false;
    next = next.replace(replacement.oldText, replacement.newText);
  }
  return next;
}

function changedSubstring(oldLine: string, newLine: string): { oldText: string; newText: string } | undefined {
  let prefixLength = 0;
  while (prefixLength < oldLine.length && prefixLength < newLine.length && oldLine[prefixLength] === newLine[prefixLength]) {
    prefixLength += 1;
  }
  let suffixLength = 0;
  while (
    suffixLength < oldLine.length - prefixLength &&
    suffixLength < newLine.length - prefixLength &&
    oldLine[oldLine.length - 1 - suffixLength] === newLine[newLine.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }
  const oldText = oldLine.slice(prefixLength, oldLine.length - suffixLength);
  const newText = newLine.slice(prefixLength, newLine.length - suffixLength);
  if (!oldText || oldText.length > 80 || oldText === newText) return undefined;
  return { oldText, newText };
}

function countOccurrences(source: string, needle: string): number {
  let count = 0;
  let index = source.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = source.indexOf(needle, index + needle.length);
  }
  return count;
}

async function rollbackAppliedPlans(plans: Array<{ absolute: string; original: string; existed: boolean }>): Promise<void> {
  for (const plan of [...plans].reverse()) {
    if (plan.existed) {
      await mkdir(path.dirname(plan.absolute), { recursive: true });
      await writeFile(plan.absolute, plan.original, "utf8");
    } else {
      await rm(plan.absolute, { force: true });
    }
  }
}
