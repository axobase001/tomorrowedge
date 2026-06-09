import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as { version: string };

describe("CLI contract", () => {
  it("prints the package version", async () => {
    const result = await execa("tsx", ["src/cli/index.ts", "--version"], {
      cwd: process.cwd(),
      preferLocal: true
    });

    expect(result.stdout.trim()).toBe(packageJson.version);
  }, 15_000);

  it("prints experimental MCP bridge status from the group command", async () => {
    const result = await execa("tsx", ["src/cli/index.ts", "mcp"], {
      cwd: process.cwd(),
      preferLocal: true
    });

    expect(result.stdout).toContain("MCP Agent Bridge: experimental");
    expect(result.stdout).toContain("stdio server");
  }, 15_000);

  it("includes MCP bridge status in doctor JSON", async () => {
    const result = await execa("tsx", ["src/cli/index.ts", "doctor", "--json"], {
      cwd: process.cwd(),
      preferLocal: true
    });
    const payload = JSON.parse(result.stdout) as { mcpBridge?: string };

    expect(payload.mcpBridge).toContain("experimental");
    expect(payload.mcpBridge).toContain("external_agents");
  }, 15_000);

  it("keeps invalid access-mode errors actionable", async () => {
    await expect(execa("tsx", ["src/cli/index.ts", "run", "noop", "--headless", "--access-mode", "godmode"], {
      cwd: process.cwd(),
      preferLocal: true
    })).rejects.toMatchObject({
      stderr: expect.stringContaining("Allowed values: restricted, partial, or full")
    });
  }, 15_000);

  it.each(["run", "client", "desktop", "models", "trace"])("keeps %s command help available", async (command) => {
    const result = await execa("tsx", ["src/cli/index.ts", command, "--help"], {
      cwd: process.cwd(),
      preferLocal: true
    });

    expect(result.stdout).toContain(`Usage: tedge ${command}`);
  }, 15_000);

  it("keeps memory subcommand options local to the subcommand", async () => {
    const failures = await execa("tsx", ["src/cli/index.ts", "memory", "failures", "--limit", "1", "--json"], {
      cwd: process.cwd(),
      preferLocal: true
    });
    const explained = await execa("tsx", ["src/cli/index.ts", "memory", "explain", "fix npm test failure", "--limit", "1", "--json"], {
      cwd: process.cwd(),
      preferLocal: true
    });

    expect(() => JSON.parse(failures.stdout)).not.toThrow();
    expect(() => JSON.parse(explained.stdout)).not.toThrow();
  }, 15_000);

  it("runs the deterministic error-loop experiment command", async () => {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "tedge-cli-error-loop-"));
    try {
      const result = await execa("tsx", [
        "src/cli/index.ts",
        "experiment",
        "error-loop",
        "--tasks",
        "fix failing test",
        "--ablation",
        "memory_on,memory_off",
        "--output-dir",
        outputRoot,
        "--json"
      ], {
        cwd: process.cwd(),
        preferLocal: true
      });
      const payload = JSON.parse(result.stdout) as { schemaVersion: string; metrics: { trials: number; memoryWritten: number }; reportPath: string };

      expect(payload.schemaVersion).toBe("error-loop-experiment/v1");
      expect(payload.metrics.trials).toBe(2);
      expect(payload.metrics.memoryWritten).toBe(1);
      expect(payload.reportPath).toContain(outputRoot);
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  }, 45_000);
});
