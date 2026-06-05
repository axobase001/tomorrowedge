import { listSessionUndoSnapshots, listUndoSnapshots, restoreLatestSessionUndoSnapshot, restoreLatestUndoSnapshot, restoreSessionUndoSnapshot, restoreUndoSnapshot } from "../../core/patch/undoManager.js";

export type UndoOptions = {
  list?: boolean;
  snapshot?: string;
  session?: boolean;
};

export async function undoCommand(cwd: string, options: UndoOptions = {}): Promise<void> {
  if (options.list) {
    if (options.session) {
      const snapshots = await listSessionUndoSnapshots(cwd);
      if (!snapshots.length) {
        process.stdout.write("No session undo snapshots found.\n");
        return;
      }
      for (const snapshot of snapshots) {
        process.stdout.write(`${snapshot.id}\t${snapshot.createdAt}\t${snapshot.files.length} file(s)\n`);
      }
      return;
    }
    const snapshots = await listUndoSnapshots(cwd);
    if (!snapshots.length) {
      process.stdout.write("No undo snapshots found.\n");
      return;
    }
    for (const snapshot of snapshots) {
      process.stdout.write(`${snapshot.id}\t${snapshot.createdAt}\t${snapshot.relativePath}\n`);
    }
    return;
  }

  if (options.snapshot) {
    if (options.session) {
      const snapshots = await listSessionUndoSnapshots(cwd);
      const target = snapshots.find((snapshot) => snapshot.id === options.snapshot || snapshot.path === options.snapshot);
      if (!target) throw new Error(`Session undo snapshot not found: ${options.snapshot}`);
      const restored = await restoreSessionUndoSnapshot(cwd, target.path);
      process.stdout.write(`Restored ${restored.restoredPaths.length} file(s) from session snapshot ${restored.snapshotId}\n`);
      return;
    }
    const snapshots = await listUndoSnapshots(cwd);
    const target = snapshots.find((snapshot) => snapshot.id === options.snapshot || snapshot.path === options.snapshot);
    if (!target) throw new Error(`Undo snapshot not found: ${options.snapshot}`);
    const restoredPath = await restoreUndoSnapshot(cwd, target.path);
    process.stdout.write(`Restored ${restoredPath} from ${target.id}\n`);
    return;
  }

  if (options.session) {
    const restored = await restoreLatestSessionUndoSnapshot(cwd);
    process.stdout.write(`Restored ${restored.restoredPaths.length} file(s) from session snapshot ${restored.snapshotId}\n`);
    return;
  }

  const restored = await restoreLatestUndoSnapshot(cwd);
  process.stdout.write(`Restored ${restored.restoredPath} from ${restored.snapshotId}\n`);
}
