import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import { createUndoSnapshot, restoreUndoSnapshot } from "../../src/core/patch/undoManager.js";
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

  it("blocks undo restores through symlinked ancestors outside the project", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-tool-fs-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "tedge-tool-outside-"));
    try {
      await mkdir(path.join(cwd, "links"));
      await symlink(outside, path.join(cwd, "links", "outside"), "dir");
      const snapshot = await createUndoSnapshot(cwd, "links/outside/escaped.txt", "escaped\n");

      await expect(restoreUndoSnapshot(cwd, snapshot)).rejects.toThrow(/escapes project root/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
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

  it("times out commands that ignore graceful termination and cleans child processes", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-tool-shell-timeout-"));
    try {
      await writeFile(path.join(cwd, "timeout-parent.cjs"), [
        'const { spawn } = require("node:child_process");',
        'const { writeFileSync } = require("node:fs");',
        'const child = spawn(process.execPath, ["-e", "process.on(\'SIGTERM\', function() {}); setInterval(function() {}, 1000);"], { stdio: "ignore" });',
        'writeFileSync("child.pid", String(child.pid || ""));',
        'process.on("SIGTERM", function() {});',
        'setInterval(function() {}, 1000);'
      ].join("\n"), "utf8");

      const started = Date.now();
      const result = await runApprovedCommand(cwd, "node timeout-parent.cjs", {
        approved: true,
        policy: "verification_allowlist",
        timeoutMs: 75,
        forceKillAfterDelayMs: 25
      });
      const childPid = Number((await readFile(path.join(cwd, "child.pid"), "utf8")).trim());

      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBe(124);
      expect(Date.now() - started).toBeLessThan(1500);
      await waitForPidExit(childPid);
      expect(isPidRunning(childPid)).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

async function waitForPidExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!isPidRunning(pid)) return;
    await delay(25);
  }
}

function isPidRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
