import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
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
});
