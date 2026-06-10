import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { writeConfig } from "../../src/config/configLoader.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";
import { approveSelectedPatch, approveTestCommand, undoLatestPatch } from "../../src/tui/state/approvalActions.js";

describe("TUI approval actions", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "tedge-tui-actions-"));
    await cp(path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic"), tempRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("applies selected judge candidate then runs tests", async () => {
    const initial = await runOfflineGraph(tempRoot, "fix failing test", defaultConfig, { provider: "fixture" });
    const applied = await approveSelectedPatch(tempRoot, initial);
    const source = await readFile(path.join(tempRoot, "index.js"), "utf8");
    const tested = await approveTestCommand(tempRoot, applied.graph);

    expect(source).toContain("return a + b");
    expect(applied.graph.changedFiles).toEqual(["index.js"]);
    expect(tested.graph.runResults[0]?.success).toBe(true);
    expect(tested.graph.finalSummary?.result).toBe("completed");
  }, 15_000);

  it("can undo the latest applied patch from TUI actions", async () => {
    const initial = await runOfflineGraph(tempRoot, "fix failing test", defaultConfig, { provider: "fixture" });
    const applied = await approveSelectedPatch(tempRoot, initial);
    const undone = await undoLatestPatch(tempRoot, applied.graph);
    const source = await readFile(path.join(tempRoot, "index.js"), "utf8");

    expect(source).toContain("return a - b");
    expect(undone.message).toContain("已从");
  });

  it("does not bypass restricted access mode from TUI actions", async () => {
    const initial = await runOfflineGraph(tempRoot, "fix failing test", defaultConfig, { provider: "fixture", accessMode: "restricted" });
    const blockedPatch = await approveSelectedPatch(tempRoot, initial);
    const sourceAfterPatch = await readFile(path.join(tempRoot, "index.js"), "utf8");
    const blockedShell = await approveTestCommand(tempRoot, { ...initial, changedFiles: ["index.js"] });

    expect(sourceAfterPatch).toContain("return a - b");
    expect(blockedPatch.graph).toBe(initial);
    expect(blockedPatch.message).toContain("restricted");
    expect(blockedPatch.graph.approvals.patchApproved).toBe(false);
    expect(blockedShell.graph.runResults).toEqual([]);
    expect(blockedShell.graph.approvals.shellApproved).toBe(false);

    const unrestricted = await runOfflineGraph(tempRoot, "fix failing test", defaultConfig, { provider: "fixture" });
    const applied = await approveSelectedPatch(tempRoot, unrestricted);
    const restrictedApplied = {
      ...applied.graph,
      access: initial.access,
      approvals: initial.approvals
    };
    const blockedUndo = await undoLatestPatch(tempRoot, restrictedApplied);
    const sourceAfterUndo = await readFile(path.join(tempRoot, "index.js"), "utf8");

    expect(sourceAfterUndo).toContain("return a + b");
    expect(blockedUndo.graph).toBe(restrictedApplied);
    expect(blockedUndo.message).toContain("restricted");
  }, 15_000);

  it("honors configured shell policy and verification allowlist in TUI shell approval", async () => {
    const config = {
      ...defaultConfig,
      shell: {
        policy: "verification_allowlist" as const,
        verification_allowlist: ["node"]
      }
    };
    await writeConfig(tempRoot, config);
    const initial = await runOfflineGraph(tempRoot, "fix failing test", config, { provider: "fixture" });
    const applied = await approveSelectedPatch(tempRoot, initial);

    await expect(approveTestCommand(tempRoot, applied.graph)).rejects.toThrow(/Shell command blocked/);
  }, 15_000);
});
