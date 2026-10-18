import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { writeConfig } from "../../src/config/configLoader.js";

const repo = process.cwd();
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function temp() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tedge-cli-fixture-cwd-"));
  roots.push(root);
  return root;
}
async function response(root: string, reason: string) {
  const dir = path.join(root, "tests", "fixtures", "provider-responses");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "default.json"), JSON.stringify({
    intent: "inspect", requiresPatchWorkflow: false, workflowKind: "read_only", confidence: 1, reason,
    scenarioType: "analysis", ambiguityLevel: "low", likelyWorkflowKind: "read_only"
  }));
}
async function cli(launch: string, target: string, extra: string[] = []) {
  const result = await execa(process.execPath, [
    "--import", path.join(repo, "node_modules", "tsx", "dist", "loader.mjs"), path.join(repo, "src", "cli", "index.ts"),
    "run", "fix failing test", "--headless", "--cwd", path.relative(launch, target), ...extra
  ], { cwd: launch });
  return JSON.parse(result.stdout);
}

describe("CLI fixture working directory", () => {
  it("uses --cwd for provider responses even when the launch directory has a competing fixture", async () => {
    const launch = await temp();
    const target = await temp();
    await response(launch, "launch-directory-response");
    await response(target, "target-workspace-response");
    await writeConfig(target, {
      ...defaultConfig,
      agents: { ...defaultConfig.agents, planner: { provider: "fixture", model: "fixture-scripted" } }
    });
    const payload = await cli(launch, target, ["--offline"]);
    const events = (await readFile(path.join(path.dirname(payload.sessionPath), "events.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(events.find((event: { type: string }) => event.type === "workflow_intent").reason).toBe("target-workspace-response");
  }, 30_000);

  it.each(["--fixture-mode", "--provider"])("preserves the ordinary sample workflow with %s and --cwd", async (flag) => {
    const launch = await temp();
    const target = await temp();
    await cp(path.join(repo, "tests", "fixtures", "sample-repo-basic"), target, { recursive: true });
    const payload = await cli(launch, target, flag === "--provider" ? [flag, "fixture"] : [flag]);
    expect(payload.judge.decision).toBe("select");
    expect(payload.judge.selectedCandidateId).toBe("fixture_candidate_a");
    expect(payload.changedFiles).toEqual([]);
    expect(await readFile(path.join(target, "index.js"), "utf8")).toContain("return a - b");
  }, 30_000);
});
