import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { prepareRunWorkspace, runCommand } from "../../src/cli/commands/run.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";
import { listUndoSnapshots, restoreLatestUndoSnapshot } from "../../src/core/patch/undoManager.js";
import { saveSession } from "../../src/core/memory/sessionMemory.js";
import { exportCommand } from "../../src/cli/commands/export.js";
import { traceCommand } from "../../src/cli/commands/trace.js";
import { tuiCommand } from "../../src/cli/commands/tui.js";
import { artifactRefs } from "../../src/core/events/eventRenderer.js";
import { renderStaticCockpit } from "../../src/cli/renderCockpit.js";

describe("fixture E2E workflow", () => {
  let tempRoot: string;
  let cleanupPaths: string[];

  beforeEach(async () => {
    cleanupPaths = [];
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "tedge-fixture-"));
    trackCleanup(tempRoot);
    await cp(path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic"), tempRoot, { recursive: true });
  });

  afterEach(async () => {
    for (const cleanupPath of [...cleanupPaths].reverse()) {
      await rm(cleanupPath, { recursive: true, force: true });
    }
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

  it("can run against an explicit --cwd project directory", async () => {
    const output = await captureStdout(() =>
      runCommand(process.cwd(), "fix failing test", {
        cwd: tempRoot,
        headless: true,
        provider: "fixture",
        approvePatch: true,
        approveShell: true
      })
    );
    const payload = JSON.parse(output) as { executionCwd: string; runResults: Array<{ success: boolean }> };

    expect(payload.executionCwd).toBe(tempRoot);
    expect(payload.runResults[0]?.success).toBe(true);
  }, 20_000);

  it("describes partial mode explicit approvals separately from full autonomy", async () => {
    const state = await runOfflineGraph(tempRoot, "fix failing test", defaultConfig, {
      provider: "fixture",
      approvePatch: true,
      approveShell: true
    });
    const accessEvent = state.events.find((event) => event.type === "access_mode");

    expect(state.access.mode).toBe("partial");
    expect(accessEvent?.description).toContain("explicit approvals: patch=yes shell=yes repair=no");
    expect(accessEvent?.description).not.toContain("FULL AUTONOMY");
  });

  it("full access mode auto-approves patch and shell actions", async () => {
    const state = await runOfflineGraph(tempRoot, "fix failing test", defaultConfig, {
      provider: "fixture",
      accessMode: "full"
    });

    expect(state.access.mode).toBe("full");
    expect(state.changedFiles).toEqual(["index.js"]);
    expect(state.runResults[0]?.success).toBe(true);
    expect(state.events.some((event) => event.type === "patch_apply" && event.applied)).toBe(true);
    expect(state.events.some((event) => event.type === "shell_run" && event.success)).toBe(true);
    const eventTypes = new Set(state.events.map((event) => event.type));
    expect(["access_mode", "context_select", "patch_candidate", "review_decision", "judge_decision", "patch_apply", "shell_run", "summary"].every((type) => eventTypes.has(type as never))).toBe(true);
  });

  it("full access mode auto-applies repair and reruns tests", async () => {
    const state = await runOfflineGraph(tempRoot, "fix failing test", defaultConfig, {
      provider: "fixture",
      accessMode: "full",
      repairOnFail: true,
      fixtureFailingPatch: true
    });
    const source = await readFile(path.join(tempRoot, "index.js"), "utf8");

    expect(state.runResults.map((result) => result.success)).toEqual([false, true]);
    expect(source).toContain("return a + b");
    expect(state.events.some((event) => event.type === "repair_attempt")).toBe(true);
    expect(state.events).toContainEqual(expect.objectContaining({
      type: "repair_policy",
      failureClass: "semantic_test_failure",
      occurrence: 1,
      action: "repair"
    }));
    expect(state.events.filter((event) => event.type === "patch_apply" && event.applied).length).toBe(2);
    expect(state.events.filter((event) => event.type === "shell_run").length).toBe(2);
    const stopReason = state.events.find((event) => event.type === "workflow_stop_reason");
    expect(stopReason && "reason" in stopReason ? stopReason.reason : "").toBe("repair applied and verification passed");
  }, 15_000);

  it("records the full repair loop in trace order and exports expanded artifacts", async () => {
    const state = await runOfflineGraph(tempRoot, "fix failing test", defaultConfig, {
      provider: "fixture",
      accessMode: "full",
      repairOnFail: true,
      fixtureFailingPatch: true
    });
    const sessionPath = await saveSession(tempRoot, state);
    const sessionDir = path.dirname(sessionPath);

    const repairTrace = state.events
      .filter((event) => ["patch_apply", "shell_run", "repair_policy", "repair_attempt", "summary"].includes(event.type))
      .map((event) => {
        if (event.type === "patch_apply") return `patch_apply:${event.phase}`;
        if (event.type === "shell_run") return `shell_run:${event.success ? "passed" : "failed"}`;
        if (event.type === "repair_policy") return `repair_policy:${event.action}`;
        if (event.type === "repair_attempt") return `repair_attempt:${event.candidateId}`;
        return `summary:${event.result}`;
      });
    expect(repairTrace).toEqual([
      "patch_apply:patch",
      "shell_run:failed",
      "repair_policy:repair",
      "repair_attempt:fixture_repair_candidate",
      "patch_apply:repair",
      "shell_run:passed",
      "summary:completed"
    ]);

    const refs = [...new Set(state.events.flatMap(artifactRefs))];
    expect(refs.length).toBeGreaterThan(0);
    const artifactContents: string[] = [];
    for (const ref of refs) {
      artifactContents.push(await readFile(path.join(sessionDir, ref), "utf8"));
    }
    expect(artifactContents.some((content) => content.includes("AssertionError"))).toBe(true);
    expect(artifactContents.some((content) => content.includes("node test.js"))).toBe(true);

    const output = await captureStdout(() => exportCommand(tempRoot, "latest", { format: "markdown" }));
    expect(output).toContain("## Artifact Details");
    expect(output).not.toContain("No artifact refs recorded.");
    expect(output).toContain("### shell_run artifacts/stdout/");
    expect(output).toContain("### shell_run artifacts/stderr/");
    expect(output).toContain("AssertionError");
    expect(output).toContain("-  return a * b;");
    expect(output).toContain("+  return a + b;");
    expect(output).toContain("completed: Implement test task");
  }, 15_000);

  it("static TUI fallback shows recent failed repair and passing events", async () => {
    const state = await runOfflineGraph(tempRoot, "fix failing test", defaultConfig, {
      provider: "fixture",
      accessMode: "full",
      repairOnFail: true,
      fixtureFailingPatch: true
    });
    const output = renderStaticCockpit(state);

    expect(output).toContain("Recent events:");
    expect(output).toContain("npm test exit=1");
    expect(output).toContain("repair candidate fixture_repair_candidate");
    expect(output).toContain("npm test exit=0");
    expect(output).toContain("result=completed");
  }, 15_000);

  it("opens the latest saved session in static TUI mode", async () => {
    const state = await runOfflineGraph(tempRoot, "fix failing test", defaultConfig, {
      provider: "fixture",
      accessMode: "full"
    });
    await saveSession(tempRoot, state);

    const output = await captureStdout(() => tuiCommand(tempRoot, "ignored live goal", { session: "latest" }));

    expect(output).toContain("TomorrowEdge cockpit summary");
    expect(output).toContain("Goal: fix failing test");
    expect(output).not.toContain("ignored live goal");
  }, 15_000);

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

  it.each([
    {
      label: "restricted ignores explicit approvals and stays non-mutating",
      options: { headless: true, fixtureMode: true, accessMode: "restricted" as const, approvePatch: true, approveShell: true, approveRepair: true },
      access: { mode: "restricted", patchApproved: false, shellApproved: false, repairApproved: false },
      approvals: { patchApproved: false, shellApproved: false, repairApproved: false },
      changedFiles: [],
      runSuccesses: [],
      expectedSource: "return a - b"
    },
    {
      label: "partial plus patch approval mutates files without running shell",
      options: { headless: true, fixtureMode: true, accessMode: "partial" as const, approvePatch: true },
      access: { mode: "partial", patchApproved: true, shellApproved: false, repairApproved: false },
      approvals: { patchApproved: true, shellApproved: false, repairApproved: false },
      changedFiles: ["index.js"],
      runSuccesses: [],
      expectedSource: "return a + b"
    },
    {
      label: "partial plus patch and shell approvals records explicit approvals",
      options: { headless: true, fixtureMode: true, accessMode: "partial" as const, approvePatch: true, approveShell: true },
      access: { mode: "partial", patchApproved: true, shellApproved: true, repairApproved: false },
      approvals: { patchApproved: true, shellApproved: true, repairApproved: false },
      changedFiles: ["index.js"],
      runSuccesses: [true],
      expectedSource: "return a + b"
    },
    {
      label: "full automatically patches shells and repairs",
      options: { headless: true, fixtureMode: true, accessMode: "full" as const, repairOnFail: true, fixtureFailingPatch: true },
      access: { mode: "full", patchApproved: true, shellApproved: true, repairApproved: true },
      approvals: { patchApproved: true, shellApproved: true, repairApproved: true },
      changedFiles: ["index.js"],
      runSuccesses: [false, true],
      expectedSource: "return a + b"
    }
  ])("prints CLI-level access semantics for $label", async ({ options, access, approvals, changedFiles, runSuccesses, expectedSource }) => {
    const output = await captureStdout(() => runCommand(tempRoot, "fix failing test", options));
    const payload = JSON.parse(output) as {
      access: Record<string, unknown>;
      approvals: Record<string, unknown>;
      changedFiles: string[];
      runResults: Array<{ success: boolean }>;
      repairCandidates: Array<{ candidateId: string }>;
    };
    const source = await readFile(path.join(tempRoot, "index.js"), "utf8");

    expect(payload.access).toMatchObject(access);
    expect(payload.approvals).toMatchObject(approvals);
    expect(payload.changedFiles).toEqual(changedFiles);
    expect(payload.runResults.map((result) => result.success)).toEqual(runSuccesses);
    expect(source).toContain(expectedSource);
    if (access.mode === "full") {
      expect(payload.repairCandidates[0]?.candidateId).toBe("fixture_repair_candidate");
    }
  }, 15_000);

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

  it("saves a replayable session directory with events and artifacts", async () => {
    const state = await runOfflineGraph(tempRoot, "fix failing test", defaultConfig, {
      provider: "fixture",
      accessMode: "full"
    });
    const sessionPath = await saveSession(tempRoot, state);
    const sessionDir = path.dirname(sessionPath);
    const eventsText = await readFile(path.join(sessionDir, "events.jsonl"), "utf8");

    expect(sessionPath.endsWith(path.join(state.sessionId, "session.json"))).toBe(true);
    expect(eventsText).toContain("\"type\":\"access_mode\"");
    expect(eventsText).toContain("\"type\":\"patch_apply\"");
    await expect(stat(path.join(sessionDir, "artifacts", "diffs"))).resolves.toBeTruthy();
  });

  it("exports markdown with expanded patch diff and shell output artifacts", async () => {
    const state = await runOfflineGraph(tempRoot, "fix failing test", defaultConfig, {
      provider: "fixture",
      accessMode: "full"
    });
    await saveSession(tempRoot, state);
    const output = await captureStdout(() => exportCommand(tempRoot, "latest", { format: "markdown" }));

    expect(output).toContain("## Artifact Details");
    expect(output).toContain("+  return a + b;");
    expect(output).toContain("node test.js");
  });

  it("exports a brief terminal summary without artifact flooding", async () => {
    const state = await runOfflineGraph(tempRoot, "fix failing test", defaultConfig, {
      provider: "fixture",
      accessMode: "full"
    });
    await saveSession(tempRoot, state);
    const output = await captureStdout(() => exportCommand(tempRoot, "latest", { format: "markdown", brief: true }));

    expect(output).toContain("TomorrowEdge Session");
    expect(output).toContain("Events:");
    expect(output).not.toContain("+  return a + b;");
    expect(output).not.toContain("## Artifact Details");
  });

  it("deduplicates artifact references in brief export counts", async () => {
    const state = await runOfflineGraph(tempRoot, "fix failing test", defaultConfig, {
      provider: "fixture",
      accessMode: "full",
      repairOnFail: true,
      fixtureFailingPatch: true
    });
    await saveSession(tempRoot, state);
    const allRefs = state.events.flatMap(artifactRefs);
    const uniqueRefs = new Set(allRefs);
    const output = await captureStdout(() => exportCommand(tempRoot, "latest", { format: "markdown", brief: true }));

    expect(allRefs.length).toBeGreaterThan(uniqueRefs.size);
    expect(output).toContain(`Artifacts: ${uniqueRefs.size}`);
    expect(output).not.toContain(`Artifacts: ${allRefs.length}`);
  });

  it("prepares a temporary fixture workspace for --fixture-mode from the project root", async () => {
    const projectRoot = await createProjectRootWithFixture();
    const workspace = await prepareRunWorkspace(projectRoot, { fixtureMode: true });
    trackCleanup(workspace.fixtureWorkspace);
    const source = await readFile(path.join(workspace.executionCwd, "index.js"), "utf8");

    expect(workspace.fixtureWorkspace).toBe(workspace.executionCwd);
    expect(workspace.executionCwd).not.toBe(projectRoot);
    expect(source).toContain("return a - b");
  });

  it("keeps --provider fixture as a deprecated fixture workspace alias", async () => {
    const projectRoot = await createProjectRootWithFixture();
    const workspace = await prepareRunWorkspace(projectRoot, { provider: "fixture" });
    trackCleanup(workspace.fixtureWorkspace);
    const source = await readFile(path.join(workspace.executionCwd, "index.js"), "utf8");

    expect(workspace.fixtureWorkspace).toBe(workspace.executionCwd);
    expect(workspace.executionCwd).not.toBe(projectRoot);
    expect(source).toContain("return a - b");
  });

  it("runs the documented fixture demo from the project root in a temporary workspace", async () => {
    const projectRoot = await createProjectRootWithFixture();
    const output = await captureStdout(() =>
      runCommand(projectRoot, "fix failing test", {
        headless: true,
        fixtureMode: true,
        approvePatch: true,
        approveShell: true
      })
    );
    const payload = JSON.parse(output) as {
      executionCwd: string;
      fixtureWorkspace?: string;
      accessSummary: string;
      changedFiles: string[];
      runResults: Array<{ success: boolean }>;
      summary?: { result?: string };
    };
    trackCleanup(payload.fixtureWorkspace);

    expect(payload.fixtureWorkspace).toBe(payload.executionCwd);
    expect(payload.accessSummary).toContain("explicit approvals: patch=yes shell=yes repair=no");
    expect(payload.changedFiles).toEqual(["index.js"]);
    expect(payload.runResults[0]?.success).toBe(true);
    expect(payload.summary?.result).toBe("completed");
    await expect(readFile(path.join(payload.executionCwd, "index.js"), "utf8")).resolves.toContain("return a + b");
    await expect(readFile(path.join(projectRoot, "tests", "fixtures", "sample-repo-basic", "index.js"), "utf8")).resolves.toContain("return a - b");
  });

  it("does not fail a patched greenfield project when default npm test is missing", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "tedge-greenfield-"));
    trackCleanup(projectRoot);
    await writeFile(path.join(projectRoot, "index.js"), "export function add(a, b) {\n  return a - b;\n}\n", "utf8");
    await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: "greenfield-no-test", type: "module" }, null, 2), "utf8");

    const state = await runOfflineGraph(projectRoot, "fix failing test", defaultConfig, {
      fixtureMode: true,
      approvePatch: true,
      approveShell: true
    });

    expect(state.changedFiles).toContain("index.js");
    expect(state.runResults[0]?.skipped).toBe(true);
    expect(state.runResults[0]?.success).toBe(true);
    expect(state.finalSummary?.result).toBe("completed");
    expect(state.finalSummary?.risksRemaining).toContain("Patch applied but verification was skipped.");
  });

  it("traces and exports sessions from an explicit --cwd root", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "tedge-session-cwd-"));
    trackCleanup(projectRoot);
    const state = await runOfflineGraph(projectRoot, "cwd scoped trace export task", defaultConfig);
    await saveSession(projectRoot, state);

    const traceOutput = await captureStdout(() => traceCommand(tempRoot, "latest", { cwd: projectRoot, verbose: true }));
    const exportOutput = await captureStdout(() => exportCommand(tempRoot, "latest", { cwd: projectRoot, format: "markdown", brief: true }));

    expect(traceOutput).toContain("cwd scoped trace export task");
    expect(exportOutput).toContain(`TomorrowEdge Session ${state.sessionId}`);
  });

  function trackCleanup(cleanupPath: string | undefined): void {
    if (cleanupPath && !cleanupPaths.includes(cleanupPath)) {
      cleanupPaths.push(cleanupPath);
    }
  }

  async function createProjectRootWithFixture(): Promise<string> {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "tedge-project-"));
    trackCleanup(projectRoot);
    const fixtureTarget = path.join(projectRoot, "tests", "fixtures", "sample-repo-basic");
    await mkdir(path.dirname(fixtureTarget), { recursive: true });
    await cp(path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic"), fixtureTarget, { recursive: true });
    return projectRoot;
  }
});

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }
  return output;
}
