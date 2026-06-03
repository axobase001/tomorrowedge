import { listUndoSnapshots, restoreLatestUndoSnapshot, restoreUndoSnapshot } from "../../core/patch/undoManager.js";

export type UndoOptions = {
  list?: boolean;
  snapshot?: string;
};

export async function undoCommand(cwd: string, options: UndoOptions = {}): Promise<void> {
  if (options.list) {
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
    const snapshots = await listUndoSnapshots(cwd);
    const target = snapshots.find((snapshot) => snapshot.id === options.snapshot || snapshot.path === options.snapshot);
    if (!target) throw new Error(`Undo snapshot not found: ${options.snapshot}`);
    const restoredPath = await restoreUndoSnapshot(cwd, target.path);
    process.stdout.write(`Restored ${restoredPath} from ${target.id}\n`);
    return;
  }

  const restored = await restoreLatestUndoSnapshot(cwd);
  process.stdout.write(`Restored ${restored.restoredPath} from ${restored.snapshotId}\n`);
}
