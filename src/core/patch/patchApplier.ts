import { applyPatch, parsePatch } from "diff";
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
  const changed: string[] = [];
  const undoSnapshotIds: string[] = [];
  const plans: Array<{ target: string; absolute: string; original: string; existed: boolean; next: string; isDelete: boolean }> = [];
  for (const [index, file] of files.entries()) {
    const target = file.isDelete ? file.oldFileName : file.newFileName || file.oldFileName;
    if (!target) continue;
    const absolute = resolveInside(cwd, target);
    const existed = await stat(absolute).then((value) => value.isFile()).catch(() => false);
    const original = existed ? await readFile(absolute, "utf8") : "";
    const next = applyPatch(original, parsedPatches[index]);
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
