import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { describe, expect, it } from "vitest";

describe("Canopus CLI", () => {
  it("canopus init generates the public schema without validation warnings", async () => {
    const cwd = await tempDir("tedge-canopus-cli-init-");
    try {
      const objectivePath = path.join(cwd, "objective.yaml");
      await cli(["canopus", "init", "--title", "Fix bug", "--output", objectivePath]);
      const yaml = await readFile(objectivePath, "utf8");
      const result = await cli(["canopus", "validate", objectivePath]);

      expect(yaml).toContain("objective:");
      expect(yaml).toContain("acceptance:");
      expect(yaml).toContain("convergence:");
      expect(yaml).toContain("target_state:");
      expect(yaml).toContain("blocking_checks:");
      expect(yaml).not.toContain("\ngoal:");
      expect(result.stdout).toContain("required conditions: 2");
      expect(result.stdout).toContain("blocking checks: 1");
      expect(result.stdout).not.toContain("warnings:");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 25_000);

  it("control alias warns on stderr without breaking JSON stdout", async () => {
    const cwd = await tempDir("tedge-canopus-cli-alias-");
    try {
      const objectivePath = path.join(cwd, "objective.yaml");
      await cli(["canopus", "init", "--title", "Fix bug", "--output", objectivePath]);
      const result = await cli(["control", "validate", objectivePath, "--json"]);
      const payload = JSON.parse(result.stdout) as { valid: boolean; warnings: string[] };

      expect(result.stderr).toContain("compatibility alias");
      expect(payload.valid).toBe(true);
      expect(payload.warnings).toEqual([]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 25_000);

  it("runs a mock reconciliation loop from the CLI", async () => {
    const cwd = await tempDir("tedge-canopus-cli-run-");
    try {
      const objectivePath = path.join(cwd, "objective.yaml");
      await writeFile(objectivePath, fileArtifactObjectiveYaml(), "utf8");
      const result = await cli([
        "canopus",
        "run",
        objectivePath,
        "--cwd",
        cwd,
        "--run-id",
        "cli_mock_run",
        "--json"
      ]);
      const payload = JSON.parse(result.stdout) as { converged: boolean; runDir: string; status: { phase: string } };

      expect(payload.converged).toBe(true);
      expect(payload.status.phase).toBe("converged");
      expect(existsSync(path.join(payload.runDir, "status.latest.json"))).toBe(true);
      expect(existsSync(path.join(payload.runDir, "trace.jsonl"))).toBe(true);
      expect(existsSync(path.join(payload.runDir, "progress.md"))).toBe(true);

      const status = await cli(["canopus", "status", "--cwd", cwd, "--run-id", "cli_mock_run"]);
      const report = await cli(["canopus", "report", "--cwd", cwd, "--run-id", "cli_mock_run"]);

      expect(status.stdout).toContain("Phase: converged");
      expect(report.stdout).toContain("# Run status");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 30_000);

  it("new schema runtime demo converges through the shell adapter", async () => {
    const cwd = await tempDir("tedge-canopus-cli-runtime-");
    try {
      const source = path.join(process.cwd(), "examples", "canopus", "simple_bugfix_runtime");
      await cp(source, cwd, { recursive: true });
      await rm(path.join(cwd, ".runs"), { recursive: true, force: true });
      await expect(execa("npm", ["test"], { cwd, timeout: 10_000, killSignal: "SIGKILL" })).rejects.toMatchObject({
        stderr: expect.stringContaining("AssertionError")
      });

      const result = await cli([
        "canopus",
        "run",
        path.join(cwd, "objective.yaml"),
        "--cwd",
        cwd,
        "--adapter",
        "shell",
        "--action-command",
        "node fix-bug.mjs",
        "--run-id",
        "canopus_cli_runtime",
        "--json"
      ], 40_000);
      const payload = JSON.parse(result.stdout) as { converged: boolean; status: { phase: string; diff: { satisfied_conditions: string[] } } };

      expect(payload.converged).toBe(true);
      expect(payload.status.phase).toBe("converged");
      expect(payload.status.diff.satisfied_conditions).toEqual(expect.arrayContaining([
        "unit_tests_pass",
        "diff_exists",
        "no_denied_path_modified",
        "evidence_collected"
      ]));
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 50_000);
});

async function cli(args: string[], timeout = 20_000) {
  return execa("tsx", ["src/cli/index.ts", ...args], {
    cwd: process.cwd(),
    preferLocal: true,
    timeout,
    killSignal: "SIGKILL"
  });
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(dir, { recursive: true });
  return dir;
}

function fileArtifactObjectiveYaml(): string {
  return [
    "objective:",
    "  id: cli_mock",
    "  title: Mock artifact",
    "  description: Create a result file.",
    "  mode: coding",
    "  target_state:",
    "    summary: result.md exists.",
    "    success_conditions:",
    "      - id: result_exists",
    "        description: result.md exists.",
    "        type: file_exists",
    "        path: result.md",
    "        required: true",
    "  constraints:",
    "    allowed_paths: ['.']",
    "    denied_paths: ['.git', '.runs']",
    "    max_files_changed: 3",
    "    max_iterations: 3",
    "    require_human_review: false",
    "  artifacts:",
    "    required:",
    "      - path: result.md",
    "        description: generated result",
    "acceptance:",
    "  blocking_checks:",
    "    - id: result_exists",
    "      type: file_exists",
    "      path: result.md",
    "      timeout_sec: 10",
    "      required: true",
    "  advisory_checks: []",
    "  judge:",
    "    mode: hard_only",
    "    reviewer_role: null",
    "    min_confidence: 0.5",
    "  evidence_required: true",
    "convergence:",
    "  max_iterations: 3",
    "  strategy: reconcile",
    "  one_item_per_loop: true",
    "  fresh_context_each_iteration: true",
    "  retry_policy:",
    "    type: none",
    "    base_delay_sec: 0",
    "    max_delay_sec: 0",
    "  stop_when:",
    "    all_hard_gates_pass: true",
    "    all_required_conditions_met: true",
    "    checker_confidence_above: null",
    "    no_unresolved_blockers: true",
    "  abort_when:",
    "    max_iterations_reached: true",
    "    no_progress_rounds: 2",
    "    repeated_failure_rounds: 3",
    "    budget_exhausted: true",
    ""
  ].join("\n");
}
