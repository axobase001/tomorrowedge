import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { makeId } from "../../utils/ids.js";
import { resolveInside } from "../tools/fsTool.js";

export type UndoSnapshot = {
  id: string;
  kind?: "file";
  relativePath: string;
  content: string;
  existed?: boolean;
  createdAt: string;
};

export type SessionUndoEntry = {
  relativePath: string;
  content: string;
  existed: boolean;
};

export type SessionUndoSnapshot = {
  id: string;
  kind: "session";
  createdAt: string;
  files: SessionUndoEntry[];
};

export async function createUndoSnapshot(cwd: string, relativePath: string, content: string, existed = true): Promise<string> {
  const snapshotDir = path.join(cwd, ".tomorrowedge", "undo");
  await mkdir(snapshotDir, { recursive: true });
  const id = makeId("undo");
  const snapshotPath = path.join(snapshotDir, `${id}.json`);
  await writeFile(snapshotPath, JSON.stringify({ id, kind: "file", relativePath, content, existed, createdAt: new Date().toISOString() }, null, 2), "utf8");
  return snapshotPath;
}

export async function restoreUndoSnapshot(cwd: string, snapshotPath: string): Promise<string> {
  const parsed = JSON.parse(await readFile(snapshotPath, "utf8")) as UndoSnapshot;
  const target = resolveInside(cwd, parsed.relativePath);
  if (parsed.existed === false) {
    await unlink(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  } else {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, parsed.content, "utf8");
  }
  return parsed.relativePath;
}

export async function createOrUpdateSessionUndoSnapshot(cwd: string, snapshotPath: string | undefined, entries: SessionUndoEntry[]): Promise<string> {
  const snapshotDir = path.join(cwd, ".tomorrowedge", "undo");
  await mkdir(snapshotDir, { recursive: true });
  const existing = snapshotPath ? await readSessionSnapshot(snapshotPath).catch(() => undefined) : undefined;
  const next: SessionUndoSnapshot = existing ?? {
    id: makeId("session_undo"),
    kind: "session",
    createdAt: new Date().toISOString(),
    files: []
  };
  const seen = new Set(next.files.map((file) => file.relativePath));
  for (const entry of entries) {
    if (seen.has(entry.relativePath)) continue;
    next.files.push(entry);
    seen.add(entry.relativePath);
  }
  const targetPath = snapshotPath ?? path.join(snapshotDir, `${next.id}.json`);
  await writeFile(targetPath, JSON.stringify(next, null, 2), "utf8");
  return targetPath;
}

export async function restoreSessionUndoSnapshot(cwd: string, snapshotPath: string): Promise<{ restoredPaths: string[]; snapshotId: string }> {
  const parsed = await readSessionSnapshot(snapshotPath);
  const restoredPaths: string[] = [];
  for (const file of [...parsed.files].reverse()) {
    const target = resolveInside(cwd, file.relativePath);
    if (!file.existed) {
      await unlink(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    } else {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.content, "utf8");
    }
    restoredPaths.push(file.relativePath);
  }
  return { restoredPaths, snapshotId: parsed.id };
}

export async function listUndoSnapshots(cwd: string): Promise<Array<UndoSnapshot & { path: string }>> {
  const snapshotDir = path.join(cwd, ".tomorrowedge", "undo");
  const names = await readdir(snapshotDir).catch(() => []);
  const snapshots = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        const snapshotPath = path.join(snapshotDir, name);
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(await readFile(snapshotPath, "utf8")) as Record<string, unknown>;
        } catch {
          return null;
        }
        if (parsed.kind === "session") return null;
        const id = typeof parsed.id === "string" ? parsed.id : path.basename(name, ".json");
        return {
          id,
          kind: "file" as const,
          relativePath: typeof parsed.relativePath === "string" ? parsed.relativePath : "",
          content: typeof parsed.content === "string" ? parsed.content : "",
          existed: typeof parsed.existed === "boolean" ? parsed.existed : true,
          createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "1970-01-01T00:00:00.000Z",
          path: snapshotPath
        };
      })
  );
  return snapshots.filter((s): s is NonNullable<typeof s> => s !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function restoreLatestUndoSnapshot(cwd: string): Promise<{ restoredPath: string; snapshotId: string }> {
  const [latest] = await listUndoSnapshots(cwd);
  if (!latest) throw new Error("No undo snapshots found.");
  const restoredPath = await restoreUndoSnapshot(cwd, latest.path);
  return { restoredPath, snapshotId: latest.id };
}

export async function listSessionUndoSnapshots(cwd: string): Promise<Array<SessionUndoSnapshot & { path: string }>> {
  const snapshotDir = path.join(cwd, ".tomorrowedge", "undo");
  const names = await readdir(snapshotDir).catch(() => []);
  const snapshots = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        const snapshotPath = path.join(snapshotDir, name);
        try {
          const parsed = await readSessionSnapshot(snapshotPath);
          return { ...parsed, path: snapshotPath };
        } catch {
          return null;
        }
      })
  );
  return snapshots.filter((s): s is NonNullable<typeof s> => s !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function restoreLatestSessionUndoSnapshot(cwd: string): Promise<{ restoredPaths: string[]; snapshotId: string }> {
  const [latest] = await listSessionUndoSnapshots(cwd);
  if (!latest) throw new Error("No session undo snapshots found.");
  return restoreSessionUndoSnapshot(cwd, latest.path);
}

async function readSessionSnapshot(snapshotPath: string): Promise<SessionUndoSnapshot> {
  const parsed = JSON.parse(await readFile(snapshotPath, "utf8")) as Partial<SessionUndoSnapshot>;
  if (parsed.kind !== "session" || !Array.isArray(parsed.files)) throw new Error(`Not a session undo snapshot: ${snapshotPath}`);
  return {
    id: parsed.id ?? path.basename(snapshotPath, ".json"),
    kind: "session",
    createdAt: parsed.createdAt ?? "1970-01-01T00:00:00.000Z",
    files: parsed.files.map((file) => ({
      relativePath: file.relativePath,
      content: file.content,
      existed: file.existed
    }))
  };
}
