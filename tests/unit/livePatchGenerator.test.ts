import { describe, expect, it } from "vitest";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import type { TomorrowEdgeConfig } from "../../src/config/schema.js";
import { PlannerAgent } from "../../src/core/agents/planner.js";
import { ExplorerAgent } from "../../src/core/agents/explorer.js";
import { buildLivePatchPlans, runLivePatchCandidates } from "../../src/core/model/livePatchGenerator.js";
import { ModelRouter } from "../../src/core/routing/router.js";

describe("live patch generator", () => {
  it("omits file contents when cloud repo context is disabled", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const config: TomorrowEdgeConfig = {
      ...defaultConfig,
      privacy: { ...defaultConfig.privacy, allow_cloud_repo_context: false }
    };
    const router = new ModelRouter(config);
    const planner = new PlannerAgent();
    const plan = await planner.run({ goal: "fix failing test" });
    const explorer = new ExplorerAgent();
    const contextSelection = await explorer.run({ plan }, { cwd, router });
    const plans = await buildLivePatchPlans({ cwd, goal: "fix failing test", config, router, plan, contextSelection });

    expect(plans[0].prompt).toContain("CONTENT: omitted");
    expect(plans[0].prompt).not.toContain("return a - b");
  });

  it("pins explicit target files from the task even when explorer misses them", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-live-context-"));
    try {
      await writeFile(path.join(cwd, "target.js"), "export const value = 1;\n", "utf8");
      await writeFile(path.join(cwd, "other.js"), "export const other = 2;\n", "utf8");
      const router = new ModelRouter(defaultConfig);
      const planner = new PlannerAgent();
      const plan = await planner.run({ goal: "change target.js" });
      const plans = await buildLivePatchPlans({
        cwd,
        goal: "Update target.js but explorer selected the wrong file.",
        config: defaultConfig,
        router,
        plan,
        contextSelection: {
          selectedFiles: [{ path: "other.js", reason: "selected by test", risk: "safe" }],
          excludedFiles: [],
          grepQueriesUsed: [],
          contextSummary: "wrong file selected"
        }
      });

      expect(plans[0].prompt).toContain("FILE: target.js");
      expect(plans[0].prompt).toContain("Explicitly mentioned in task");
      expect(plans[0].prompt).toContain("export const value = 1");
      expect(plans[0].prompt).toContain("FILE: other.js");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("omits binary image contents from live patch context", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-live-binary-context-"));
    try {
      await writeFile(path.join(cwd, "screen.png"), "\u0000PNG fake image bytes", "utf8");
      await writeFile(path.join(cwd, "README.md"), "roughly 540k parameters by default\n", "utf8");
      const router = new ModelRouter(defaultConfig);
      const planner = new PlannerAgent();
      const plan = await planner.run({ goal: "update README.md" });
      const plans = await buildLivePatchPlans({
        cwd,
        goal: "Update README.md from roughly 540k parameters by default to roughly 50M parameters by default.",
        config: defaultConfig,
        router,
        plan,
        contextSelection: {
          selectedFiles: [
            { path: "screen.png", reason: "matched screenshot keyword", risk: "safe" },
            { path: "README.md", reason: "target doc", risk: "safe" }
          ],
          excludedFiles: [],
          grepQueriesUsed: [],
          contextSummary: "mixed binary and text"
        }
      });

      expect(plans[0].prompt).toContain("FILE: screen.png");
      expect(plans[0].prompt).toContain("binary/image files are not safe text patch context");
      expect(plans[0].prompt).not.toContain("fake image bytes");
      expect(plans[0].prompt).toContain("Preserve requested wording exactly");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("keeps binary image files out of explorer-selected safe context", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-explorer-binary-"));
    try {
      await writeFile(path.join(cwd, "screen.png"), "fake image bytes mentioning readme and local model", "utf8");
      await writeFile(path.join(cwd, "README.md"), "local model roughly 540k parameters by default\n", "utf8");
      const router = new ModelRouter(defaultConfig);
      const planner = new PlannerAgent();
      const plan = await planner.run({ goal: "update README.md local model docs" });
      const explorer = new ExplorerAgent();
      const contextSelection = await explorer.run({ plan }, { cwd, router });

      expect(contextSelection.selectedFiles.map((file) => file.path)).toContain("README.md");
      expect(contextSelection.selectedFiles.map((file) => file.path)).not.toContain("screen.png");
      expect(contextSelection.excludedFiles).toContainEqual({ path: "screen.png", reason: "Excluded as binary." });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects schema-valid live patch responses with empty diffs", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-live-empty-diff-"));
    const originalFetch = globalThis.fetch;
    try {
      await writeFile(path.join(cwd, "index.js"), "export const value = 1;\n", "utf8");
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: "Explained the change but did not provide a patch.",
                    filesChanged: ["index.js"],
                    unifiedDiff: "",
                    testPlan: ["npm test"],
                    knownTradeoffs: [],
                    estimatedRisk: "low"
                  })
                }
              }
            ],
            usage: { prompt_tokens: 10, completion_tokens: 10 }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )) as typeof fetch;
      const config: TomorrowEdgeConfig = {
        ...defaultConfig,
        providers: {
          ...defaultConfig.providers,
          openai_compatible: {
            ...defaultConfig.providers.openai_compatible,
            enabled: true,
            api_key_env: "",
            base_url: "http://provider.test/v1",
            model: "free-test-model",
            auth_header: "none"
          }
        },
        agents: {
          ...defaultConfig.agents,
          coder_a: { provider: "openai_compatible", model: "free-test-model" },
          coder_b: { provider: "openai_compatible", model: "free-test-model" }
        }
      };
      const router = new ModelRouter(config);
      const planner = new PlannerAgent();
      const plan = await planner.run({ goal: "update index.js" });

      const result = await runLivePatchCandidates({
        cwd,
        goal: "Update index.js",
        config,
        router,
        plan,
        contextSelection: {
          selectedFiles: [{ path: "index.js", reason: "target file", risk: "safe" }],
          excludedFiles: [],
          grepQueriesUsed: [],
          contextSummary: "single file"
        }
      });

      expect(result.candidates).toHaveLength(2);
      expect(result.candidates.every((candidate) => candidate.filesChanged.length === 0 && candidate.unifiedDiff === "")).toBe(true);
      expect(result.notes.every((note) => note.retryUsed)).toBe(true);
      expect(result.notes.map((note) => note.error).join("\n")).toContain("usable unified diff");
    } finally {
      globalThis.fetch = originalFetch;
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
