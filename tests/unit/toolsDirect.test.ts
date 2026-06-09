import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readProjectFile, resolveInside } from "../../src/core/tools/fsTool.js";
import { grepProject } from "../../src/core/tools/grepTool.js";
import { runApprovedCommand } from "../../src/core/tools/shellTool.js";

describe("direct tool contracts", () => {
  it("reads files inside the project and blocks path traversal", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-tool-fs-"));
    try {
      await writeFile(path.join(cwd, "index.js"), "export const value = 42;\n");

      await expect(readProjectFile(cwd, "index.js")).resolves.toContain("42");
      expect(resolveInside(cwd, ".")).toBe(path.resolve(cwd));
      expect(() => resolveInside(cwd, "../escape.txt")).toThrow(/escapes project root/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("greps indexed safe project files only", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-tool-grep-"));
    try {
      await writeFile(path.join(cwd, "index.js"), "export function target() { return true; }\n");
      await writeFile(path.join(cwd, ".env"), "TARGET_SECRET=hidden\n");

      const hits = await grepProject(cwd, /target/i);

      expect(hits.some((hit) => hit.path === "index.js")).toBe(true);
      expect(hits.some((hit) => hit.path === ".env")).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("runs approved commands and blocks unapproved shell execution", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-tool-shell-"));
    try {
      await expect(runApprovedCommand(cwd, "node -e \"console.log(42)\"", false)).rejects.toThrow(/approval required/);
      const result = await runApprovedCommand(cwd, "node -e \"console.log(42)\"", {
        approved: true,
        policy: "verification_allowlist"
      });

      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe("42");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
