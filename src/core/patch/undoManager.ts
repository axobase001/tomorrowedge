import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { makeId } from "../../utils/ids.js";
import { resolveInside } from "../tools/fsTool.js";

export type UndoSnapshot = {
  id: string;
  relativePath: string;
  content: string;
  createdAt: string;
};

export async function createUndoSnapshot(cwd: string, relativePath: string, content: string): Promise<string> {
  const snapshotDir = path.join(cwd, ".tomorrowedge", "undo");
  await mkdir(snapshotDir, { recursive: true });
  const id = makeId("undo");
  const snapshotPath = path.join(snapshotDir, `${id}.json`);
  await writeFile(snapshotPath, JSON.stringify({ id, relativePath, content, createdAt: new Date().toISOString() }, null, 2), "utf8");
  return snapshotPath;
}

export async function restoreUndoSnapshot(cwd: string, snapshotPath: string): Promise<string> {
  const parsed = JSON.parse(await readFile(snapshotPath, "utf8")) as UndoSnapshot;
  const target = resolveInside(cwd, parsed.relativePath);
  await writeFile(target, parsed.content, "utf8");
  return parsed.relativePath;
}

export async function listUndoSnapshots(cwd: string): Promise<Array<UndoSnapshot & { path: string }>> {
  const snapshotDir = path.join(cwd, ".tomorrowedge", "undo");
  const names = await readdir(snapshotDir).catch(() => []);
  const snapshots = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        const snapshotPath = path.join(snapshotDir, name);
        const parsed = JSON.parse(await readFile(snapshotPath, "utf8")) as Partial<UndoSnapshot>;
        const id = parsed.id ?? path.basename(name, ".json");
        return {
          id,
          relativePath: parsed.relativePath ?? "",
          content: parsed.content ?? "",
          createdAt: parsed.createdAt ?? "1970-01-01T00:00:00.000Z",
          path: snapshotPath
        };
      })
  );
  return snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function restoreLatestUndoSnapshot(cwd: string): Promise<{ restoredPath: string; snapshotId: string }> {
  const [latest] = await listUndoSnapshots(cwd);
  if (!latest) throw new Error("No undo snapshots found.");
  const restoredPath = await restoreUndoSnapshot(cwd, latest.path);
  return { restoredPath, snapshotId: latest.id };
}
