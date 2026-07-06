import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("atomic persistence writes", () => {
  afterEach(() => {
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  });

  it("replaces an existing file through an atomic temp-file rename", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-atomic-write-"));
    try {
      const target = path.join(cwd, "state.json");
      await writeFile(target, "previous", "utf8");
      const { writeFileAtomic } = await import("../../src/core/persistence/atomicWrite.js");

      await writeFileAtomic(target, "next");

      expect(await readFile(target, "utf8")).toBe("next");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("keeps the previous file when the atomic rename fails", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-atomic-write-fail-"));
    try {
      const target = path.join(cwd, "state.json");
      await writeFile(target, "previous", "utf8");
      vi.resetModules();
      vi.doMock("node:fs/promises", async () => {
        const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
        return {
          ...actual,
          rename: vi.fn(async () => {
            throw new Error("simulated rename failure");
          })
        };
      });
      const { writeFileAtomic } = await import("../../src/core/persistence/atomicWrite.js");

      await expect(writeFileAtomic(target, "next")).rejects.toThrow("simulated rename failure");

      expect(await readFile(target, "utf8")).toBe("previous");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
