import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyUnifiedDiff } from "../../src/core/patch/patchApplier.js";
import { parseUnifiedDiff } from "../../src/core/patch/patchParser.js";
import { renderDiffSummary } from "../../src/core/patch/diffRenderer.js";
import { validateUnifiedDiff } from "../../src/core/patch/patchValidator.js";

describe("patch utilities", () => {
  const diff = `--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-old
+new`;

  it("parses unified diff file targets", () => {
    const files = parseUnifiedDiff(diff);
    expect(files[0].newFileName).toBe("a.txt");
  });

  it("parses create and delete targets", () => {
    const createDiff = `--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+hello`;
    const deleteDiff = `--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye`;

    expect(parseUnifiedDiff(createDiff)[0]).toMatchObject({ oldFileName: "", newFileName: "new.txt", isCreate: true });
    expect(parseUnifiedDiff(deleteDiff)[0]).toMatchObject({ oldFileName: "old.txt", newFileName: "", isDelete: true });
  });

  it("flags rename and binary patches for manual handling", () => {
    const renameDiff = `--- a/old.txt
+++ b/new.txt
@@ -1 +1 @@
-old
+new`;
    const binaryDiff = `--- a/image.png
+++ b/image.png
GIT binary patch
literal 0
`;

    expect(parseUnifiedDiff(renameDiff)[0]?.isRename).toBe(true);
    expect(validateUnifiedDiff(process.cwd(), renameDiff).issues[0]?.reason).toContain("rename");
    expect(validateUnifiedDiff(process.cwd(), binaryDiff).issues[0]?.reason).toContain("binary");
  });

  it("renders diff summary", () => {
    expect(renderDiffSummary(diff)).toContain("+1 / -1");
  });

  it("blocks sensitive patch targets", () => {
    const sensitiveDiff = `--- a/.env
+++ b/.env
@@ -1 +1 @@
-TOKEN=old
+TOKEN=new`;
    const result = validateUnifiedDiff(process.cwd(), sensitiveDiff);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.reason).toContain("ignored");
  });

  it("blocks path traversal targets", () => {
    const traversalDiff = `--- a/../outside.txt
+++ b/../outside.txt
@@ -1 +1 @@
-old
+new`;
    const result = validateUnifiedDiff(process.cwd(), traversalDiff);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.reason).toContain("escapes");
  });

  it("applies create and delete patches", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-patch-"));
    try {
      await writeFile(path.join(cwd, "old.txt"), "bye\n", "utf8");
      await applyUnifiedDiff(
        cwd,
        `--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+hello
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
`,
        true
      );

      expect(await readFile(path.join(cwd, "new.txt"), "utf8")).toContain("hello");
      await expect(stat(path.join(cwd, "old.txt"))).rejects.toThrow();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rolls back already-written files when a later file write fails", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-patch-rollback-"));
    try {
      await writeFile(path.join(cwd, "a.txt"), "old\n", "utf8");
      await writeFile(path.join(cwd, "blocker"), "not a directory\n", "utf8");

      await expect(
        applyUnifiedDiff(
          cwd,
          `--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-old
+new
--- /dev/null
+++ b/blocker/new.txt
@@ -0,0 +1 @@
+hello
`,
          true
        )
      ).rejects.toThrow();

      expect(await readFile(path.join(cwd, "a.txt"), "utf8")).toBe("old\n");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
