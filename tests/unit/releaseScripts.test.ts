import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { auditExitCode, isUnsupportedAuditEndpoint, shouldSkipAudit } from "../../scripts/audit-check.js";
import { findPackRelevantUntrackedFiles, packageFilesToGlobPatterns } from "../../scripts/pack-dry.js";

describe("release verification scripts", () => {
  it("treats unsupported npm audit endpoints as warn-only", () => {
    const unsupported = "npm error audit endpoint returned an error\n404 Not Found - POST https://registry.example/-/npm/v1/security/advisories/bulk";

    expect(isUnsupportedAuditEndpoint(unsupported)).toBe(true);
    expect(auditExitCode({ exitCode: 1, output: unsupported })).toBe(0);
    expect(auditExitCode({ exitCode: 1, output: "found 1 high severity vulnerability" })).toBe(1);
    expect(shouldSkipAudit({ SKIP_AUDIT: "1" })).toBe(true);
  });

  it("detects untracked files that match package file globs", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-pack-guard-"));
    try {
      await writeFile(path.join(cwd, "package.json"), JSON.stringify({ files: ["docs/*.md"] }), "utf8");
      await mkdir(path.join(cwd, "docs"));
      await writeFile(path.join(cwd, "docs", "tracked.md"), "tracked\n", "utf8");
      await writeFile(path.join(cwd, "docs", "untracked.md"), "untracked\n", "utf8");
      await writeFile(path.join(cwd, "scratch.txt"), "not packaged\n", "utf8");
      await execa("git", ["init"], { cwd });
      await execa("git", ["add", "package.json", "docs/tracked.md"], { cwd });

      const risky = await findPackRelevantUntrackedFiles(cwd, ["docs/*.md"]);

      expect(risky).toEqual(["docs/untracked.md"]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("expands package directories into recursive pack patterns", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-pack-patterns-"));
    try {
      await mkdir(path.join(cwd, "dist"));

      expect(packageFilesToGlobPatterns(cwd, ["dist", "docs/*.md"])).toEqual(expect.arrayContaining(["dist/**", "docs/*.md"]));
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
