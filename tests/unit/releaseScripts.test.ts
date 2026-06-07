import { inflateRawSync } from "node:zlib";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { auditExitCode, isUnsupportedAuditEndpoint, shouldSkipAudit } from "../../scripts/audit-check.js";
import { findPackRelevantUntrackedFiles, packageFilesToGlobPatterns, runPackDry } from "../../scripts/pack-dry.js";
import { assertCockpitWebZipEntries, createZipArchive } from "../../scripts/package-zip.js";
import { assertCockpitAssetPaths, parseNpmPackFiles } from "../../scripts/package-smoke.js";

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

  it("warns in everyday pack mode but fails in strict release mode", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-pack-strict-"));
    try {
      await writeFile(path.join(cwd, "package.json"), JSON.stringify({ name: "pack-strict-fixture", version: "0.0.0", files: ["docs/*.md"] }), "utf8");
      await mkdir(path.join(cwd, "docs"));
      await writeFile(path.join(cwd, "docs", "draft.md"), "draft\n", "utf8");
      await execa("git", ["init"], { cwd });
      await execa("git", ["add", "package.json"], { cwd });

      expect(await runPackDry(cwd, ["--strict"])).toBe(1);
      expect(await runPackDry(cwd, [])).toBe(0);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 30_000);


  it("expands package directories into recursive pack patterns", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-pack-patterns-"));
    try {
      await mkdir(path.join(cwd, "dist"));

      expect(packageFilesToGlobPatterns(cwd, ["dist", "docs/*.md"])).toEqual(expect.arrayContaining(["dist/**", "docs/*.md"]));
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("creates zip archives without requiring the system zip command", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-package-zip-"));
    try {
      const readme = path.join(cwd, "README.md");
      const docsDir = path.join(cwd, "docs");
      const output = path.join(cwd, "tomorrowedge.zip");
      await mkdir(docsDir);
      await writeFile(readme, "hello from tomorrowedge\n", "utf8");
      await writeFile(path.join(docsDir, "guide.md"), "guide body\n", "utf8");

      await createZipArchive(output, [
        { entryName: "tomorrowedge/README.md", sourcePath: readme },
        { entryName: "tomorrowedge/docs/guide.md", sourcePath: path.join(docsDir, "guide.md") }
      ]);

      const entries = readLocalZipEntries(await readFile(output));
      expect(entries.get("tomorrowedge/README.md")?.toString("utf8")).toBe("hello from tomorrowedge\n");
      expect(entries.get("tomorrowedge/docs/guide.md")?.toString("utf8")).toBe("guide body\n");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("requires portable cockpit-web asset paths in zip archives", () => {
    expect(() => assertCockpitWebZipEntries([
      "tomorrowedge/dist/cockpit-web/index.html",
      "tomorrowedge/dist/cockpit-web/assets/index-abc.js",
      "tomorrowedge/dist/cockpit-web/assets/index-abc.css"
    ])).not.toThrow();
    expect(() => assertCockpitWebZipEntries([
      "tomorrowedge/dist/cockpit-web/index.html",
      "tomorrowedge/dist/cockpit-web/assets/index-abc.js"
    ])).toThrow("dist/cockpit-web/assets/*.css");
  });

  it("parses npm pack output and requires cockpit web assets", () => {
    const files = parseNpmPackFiles(JSON.stringify([{
      files: [
        { path: "package.json" },
        { path: "dist/cockpit-web/index.html" },
        { path: "dist/cockpit-web/assets/index-abc.js" },
        { path: "dist/cockpit-web/assets/index-abc.css" }
      ]
    }]));

    expect(files).toContain("dist/cockpit-web/index.html");
    expect(() => assertCockpitAssetPaths(files)).not.toThrow();
  });

  it("accepts package and zip archive prefixes when checking cockpit assets", () => {
    expect(() => assertCockpitAssetPaths([
      "package/dist/cockpit-web/index.html",
      "tomorrowedge\\dist\\cockpit-web\\assets\\index.js",
      "tomorrowedge/dist/cockpit-web/assets/index.css"
    ])).not.toThrow();
  });

  it("fails package asset checks when the cockpit build is missing", () => {
    expect(() => assertCockpitAssetPaths([
      "dist/cli/index.js",
      "dist/cockpit-web/index.html"
    ])).toThrow("dist/cockpit-web/assets/*.js");
  });
});

function readLocalZipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 4 <= buffer.byteLength && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const payload = buffer.subarray(dataStart, dataEnd);
    entries.set(name, method === 8 ? inflateRawSync(payload) : payload);
    offset = dataEnd;
  }
  return entries;
}
