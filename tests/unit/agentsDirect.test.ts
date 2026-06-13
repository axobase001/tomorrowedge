import { describe, expect, it } from "vitest";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PlannerAgent } from "../../src/core/agents/planner.js";
import { ExplorerAgent } from "../../src/core/agents/explorer.js";
import { CoderAgent } from "../../src/core/agents/coder.js";
import { RepairerAgent } from "../../src/core/agents/repairer.js";
import { SummarizerAgent } from "../../src/core/agents/summarizer.js";
import { VisionAgent } from "../../src/core/agents/vision.js";

describe("direct agent contracts", () => {
  it("planner and explorer produce task plan and safe context selection", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-agents-context-"));
    try {
      await cp(path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic"), cwd, { recursive: true });
      const plan = await new PlannerAgent().run({ goal: "fix failing npm test in index.js" });
      const context = await new ExplorerAgent().run({ plan }, { cwd });

      expect(plan.taskType).toBe("unknown");
      expect(plan.workflowKind).toBe("ask_user");
      expect(plan.verificationCommands).toEqual([]);
      expect(plan.steps[0]?.id).toBe("semantic-route-required");
      expect(context.selectedFiles.some((file) => file.path === "index.js")).toBe(true);
      expect(context.selectedFiles.every((file) => file.risk === "safe")).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("coder and repairer return inspectable fixture patch candidates", async () => {
    const plan = await new PlannerAgent().run({ goal: "fix failing npm test in index.js" });
    const contextSelection = {
      selectedFiles: [{ path: "index.js", reason: "fixture", risk: "safe" as const }],
      excludedFiles: [],
      grepQueriesUsed: ["index"],
      contextSummary: "fixture"
    };
    const coder = await new CoderAgent().run({ plan, contextSelection, variant: "a", fixtureMode: true, fixtureFailingPatch: true });
    const repairer = await new RepairerAgent().run({
      plan,
      appliedFiles: ["index.js"],
      fixtureMode: true,
      failedRun: {
        command: "npm test",
        exitCode: 1,
        stdout: "",
        stderr: "expected 5",
        durationMs: 1,
        success: false
      }
    });

    expect(coder.filesChanged).toEqual(["index.js"]);
    expect(coder.unifiedDiff).toContain("return a * b");
    expect(repairer.filesChanged).toEqual(["index.js"]);
    expect(repairer.unifiedDiff).toContain("return a + b");
  });

  it("summarizer distinguishes completed, failed, and partial workflow outcomes", async () => {
    const plan = await new PlannerAgent().run({ goal: "fix failing test" });
    const summarizer = new SummarizerAgent();

    await expect(summarizer.run({ plan, changedFiles: ["index.js"], testsRun: ["npm test"], evidence: ["Command passed: npm test"] })).resolves.toMatchObject({ result: "completed" });
    await expect(summarizer.run({ plan, changedFiles: ["index.js"], testsRun: ["npm test"], evidence: ["Command failed: npm test"] })).resolves.toMatchObject({ result: "failed" });
    await expect(summarizer.run({
      plan: { ...plan, taskType: "docs" },
      changedFiles: ["assignments/gpt55-smoke-test/README.md"],
      testsRun: ["npm test"],
      evidence: ["Command failed: npm test"]
    })).resolves.toMatchObject({
      result: "partially_completed",
      risksRemaining: ["Patch applied, but verification failed; inspect whether the failure is related to the requested document/content files."]
    });
    await expect(summarizer.run({ plan, changedFiles: [], testsRun: [], evidence: [] })).resolves.toMatchObject({ result: "partially_completed" });
  });

  it("vision agent emits a structured visual handoff from image inputs", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-agent-vision-"));
    try {
      const imagePath = path.join(cwd, "dashboard.png");
      await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const spec = await new VisionAgent().run({ goal: "turn this dashboard screenshot into a React page", imagePaths: [imagePath] });

      expect(spec.sourceImages[0]?.exists).toBe(true);
      expect(spec.pageType).toBe("dashboard");
      expect(spec.handoffPrompt).toContain("Visual Spec");
      expect(spec.components.length).toBeGreaterThan(0);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
