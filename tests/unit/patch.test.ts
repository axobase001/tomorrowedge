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

  it("rejects diffs that parse to no file targets", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-empty-patch-"));
    try {
      await expect(applyUnifiedDiff(cwd, "@@ -1 +1 @@\n-old\n+new", true)).rejects.toThrow("unified diff file target is missing");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("normalizes bare blank context lines inside hunks", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-blank-context-"));
    try {
      await writeFile(path.join(cwd, "doc.md"), "before\nold\n\nnext\n", "utf8");
      await applyUnifiedDiff(
        cwd,
        `--- a/doc.md
+++ b/doc.md
@@ -1,4 +1,4 @@
 before
-old
+new

 next
`,
        true
      );

      expect(await readFile(path.join(cwd, "doc.md"), "utf8")).toBe("before\nnew\n\nnext\n");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("applies patches with small stale context drift", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-fuzzy-context-"));
    try {
      await writeFile(
        path.join(cwd, "README.md"),
        "The demo is a local bilingual Chinese/English hashed neural n-gram toy language\nmodel with roughly 540k parameters by default, not an OpenAI or OpenRouter API\ncall. It exposes `/health`, `/model-info`, and `/generate`, plus a frontend with\n",
        "utf8"
      );
      await applyUnifiedDiff(
        cwd,
        `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1,3 +1,3 @@
 The demo is a local bilingual Chinese/English hashed neural n-gram toy language
-model with roughly 540k parameters by default, not an OpenAI or OpenRouter API
+model with roughly 50M parameters by default, not an OpenAI or OpenRouter API
 call. It exposes \`/health\`, \`/model-info\`, \`/generate\`, plus a frontend with
`,
        true
      );

      expect(await readFile(path.join(cwd, "README.md"), "utf8")).toContain("roughly 50M parameters");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("applies a unique changed substring when a one-line diff has stale wrapping", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-substring-context-"));
    try {
      await writeFile(
        path.join(cwd, "README.md"),
        "The demo is a local bilingual Chinese/English hashed neural n-gram toy language\nmodel with roughly 540k parameters by default, not an OpenAI or OpenRouter API\ncall.\n",
        "utf8"
      );
      await applyUnifiedDiff(
        cwd,
        `--- a/README.md
+++ b/README.md
@@ -1,3 +1,3 @@
-This demo is a local bilingual hashed neural n-gram toy language model with roughly 540k parameters by default. It does not call OpenAI, OpenRouter, or any cloud API.
+This demo is a local bilingual hashed neural n-gram toy language model with roughly 50M parameters by default. It does not call OpenAI, OpenRouter, or any cloud API.
`,
        true
      );

      const content = await readFile(path.join(cwd, "README.md"), "utf8");
      expect(content).toContain("roughly 50M parameters by default");
      expect(content).not.toContain("roughly 540k parameters by default");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects changed-substring fallback when the old fragment is ambiguous", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-substring-ambiguous-"));
    try {
      await writeFile(
        path.join(cwd, "README.md"),
        "first roughly 540k parameters by default\nsecond roughly 540k parameters by default\n",
        "utf8"
      );

      await expect(
        applyUnifiedDiff(
          cwd,
          `--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-This demo has roughly 540k parameters by default.
+This demo has roughly 50M parameters by default.
`,
          true
        )
      ).rejects.toThrow("Failed to apply patch");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
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
