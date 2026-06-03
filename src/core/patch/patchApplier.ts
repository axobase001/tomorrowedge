import { applyPatch, parsePatch } from "diff";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseUnifiedDiff } from "./patchParser.js";
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
  assertPatchSafe(cwd, unifiedDiff);
  const files = parseUnifiedDiff(unifiedDiff);
  const parsedPatches = parsePatch(unifiedDiff);
  const changed: string[] = [];
  const undoSnapshotIds: string[] = [];
  for (const [index, file] of files.entries()) {
    const target = file.isDelete ? file.oldFileName : file.newFileName || file.oldFileName;
    if (!target) continue;
    const absolute = resolveInside(cwd, target);
    await mkdir(path.dirname(absolute), { recursive: true });
    const original = await readFile(absolute, "utf8").catch(() => "");
    undoSnapshotIds.push(await createUndoSnapshot(cwd, target, original));
    const next = applyPatch(original, parsedPatches[index]);
    if (next === false) {
      throw new Error(`Failed to apply patch for ${target}`);
    }
    if (file.isDelete) {
      await rm(absolute, { force: true });
    } else {
      await writeFile(absolute, next, "utf8");
    }
    changed.push(target);
  }
  return { changedFiles: changed, undoSnapshotIds };
}
