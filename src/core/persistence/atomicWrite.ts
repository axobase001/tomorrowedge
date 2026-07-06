import { randomBytes } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";

export type AtomicWriteOptions = {
  encoding?: BufferEncoding;
  mode?: number;
  fsync?: boolean;
};

export async function writeFileAtomic(filePath: string, content: string, options: BufferEncoding | AtomicWriteOptions = "utf8"): Promise<void> {
  const normalized = typeof options === "string" ? { encoding: options } : options;
  const target = path.resolve(filePath);
  const dir = path.dirname(target);
  const tempPath = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now()}.${randomBytes(6).toString("hex")}.tmp`);
  const shouldSync = normalized.fsync !== false;

  await mkdir(dir, { recursive: true });
  try {
    const handle = await open(tempPath, "w", normalized.mode);
    try {
      await handle.writeFile(content, normalized.encoding ?? "utf8");
      if (shouldSync) await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, target);
    if (shouldSync) await syncDirectory(dir);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function syncDirectory(dir: string): Promise<void> {
  const handle = await open(dir, "r").catch(() => undefined);
  if (!handle) return;
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
