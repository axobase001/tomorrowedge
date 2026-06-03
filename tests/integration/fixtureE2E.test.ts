import { mkdtemp, readFile, rm, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";
import { listUndoSnapshots, restoreLatestUndoSnapshot } from "../../src/core/patch/undoManager.js";

describe("fixture E2E workflow", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "tedge-fixture-"));
    await cp(path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic"), tempRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("selects a fixture patch but blocks apply by default", async () => {
    const state = await runOfflineGraph(tempRoot, "fix failing test", defaultConfig, { provider: "fixture" });
    const source = await readFile(path.join(tempRoot, "index.js"), "utf8");

    expect(state.judge?.decision).toBe("select");
    expect(state.judge?.selectedCandidateId).toBe("fixture_candidate_a");
    expect(state.changedFiles).toEqual([]);
    expect(source).toContain("return a - b");
    expect(state.agents.some((agent) => agent.status === "waiting_for_user" && agent.summary.includes("approval required"))).toBe(true);
  });

  it("applies a fixture patch when patch approval is explicit", async () => {
    const state = await runOfflineGraph(tempRoot, "fix failing test", defaultConfig, { provider: "fixture", approvePatch: true });
    const source = await readFile(path.join(tempRoot, "index.js"), "utf8");

    expect(state.changedFiles).toEqual(["index.js"]);
    expect(source).toContain("return a + b");
    expect(state.runResults).toEqual([]);
    expect(state.finalSummary?.result).toBe("partially_completed");
  });

  it("creates an undo snapshot and can restore the latest patch", async () => {
    await runOfflineGraph(tempRoot, "fix failing test", defaultConfig, { provider: "fixture", approvePatch: true });
    expect((await readFile(path.join(tempRoot, "index.js"), "utf8"))).toContain("return a + b");

    const snapshots = await listUndoSnapshots(tempRoot);
    expect(snapshots[0]?.relativePath).toBe("index.js");

    const restored = await restoreLatestUndoSnapshot(tempRoot);
    expect(restored.restoredPath).toBe("index.js");
    expect((await readFile(path.join(tempRoot, "index.js"), "utf8"))).toContain("return a - b");
  });

  it("applies patch and runs tests when both approvals are explicit", async () => {
    const state = await runOfflineGraph(tempRoot, "fix failing test", defaultConfig, {
      provider: "fixture",
      approvePatch: true,
      approveShell: true
    });

    expect(state.changedFiles).toEqual(["index.js"]);
    expect(state.runResults[0]?.success).toBe(true);
    expect(state.finalSummary?.result).toBe("completed");
    expect(state.finalSummary?.evidence).toContain("Command passed: npm test");
  });

  it("full access mode auto-approves patch and shell actions", async () => {
    const state = await runOfflineGraph(tempRoot, "fix failing test", defaultConfig, {
      provider: "fixture",
      accessMode: "full"
    });

    expect(state.access.mode).toBe("full");
    expect(state.changedFiles).toEqual(["index.js"]);
    expect(state.runResults[0]?.success).toBe(true);
  });

  it("restricted access mode blocks patch application even when approval flags are present", async () => {
    const state = await runOfflineGraph(tempRoot, "fix failing test", defaultConfig, {
      provider: "fixture",
      accessMode: "restricted",
      approvePatch: true,
      approveShell: true
    });
    const source = await readFile(path.join(tempRoot, "index.js"), "utf8");

    expect(state.access.mode).toBe("restricted");
    expect(state.changedFiles).toEqual([]);
    expect(source).toContain("return a - b");
  });

  it("records red-team review findings when enabled", async () => {
    const state = await runOfflineGraph(tempRoot, "fix failing test", defaultConfig, {
      provider: "fixture",
      redTeamReview: true
    });

    expect(state.review?.mode).toBe("red_team");
    expect(state.review?.reviews[0]?.redTeamFindings[0]?.id).toBe("bounded_fixture_change");
    expect(state.judge?.reason).toContain("Red-team findings");
  });

  it("proposes a repair candidate after a failing approved patch", async () => {
    const state = await runOfflineGraph(tempRoot, "fix failing test", defaultConfig, {
      provider: "fixture",
      approvePatch: true,
      approveShell: true,
      repairOnFail: true,
      fixtureFailingPatch: true
    });
    const source = await readFile(path.join(tempRoot, "index.js"), "utf8");

    expect(state.runResults[0]?.success).toBe(false);
    expect(state.repairCandidates[0]?.candidateId).toBe("fixture_repair_candidate");
    expect(source).toContain("return a * b");
    expect(state.agents.some((agent) => agent.id === "approval_repair" && agent.status === "waiting_for_user")).toBe(true);
  });

  it("applies a repair candidate and reruns tests when repair approval is explicit", async () => {
    const state = await runOfflineGraph(tempRoot, "fix failing test", defaultConfig, {
      provider: "fixture",
      approvePatch: true,
      approveShell: true,
      repairOnFail: true,
      approveRepair: true,
      fixtureFailingPatch: true
    });
    const source = await readFile(path.join(tempRoot, "index.js"), "utf8");

    expect(state.runResults.map((result) => result.success)).toEqual([false, true]);
    expect(state.repairCandidates[0]?.candidateId).toBe("fixture_repair_candidate");
    expect(source).toContain("return a + b");
    expect(state.finalSummary?.result).toBe("completed");
    expect(state.finalSummary?.evidence).toContain("Command passed: npm test");
  });
});
