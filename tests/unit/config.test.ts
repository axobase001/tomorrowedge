import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getConfigPath, loadConfig, writeDefaultConfig } from "../../src/config/configLoader.js";

describe("config loader", () => {
  it("loads safe offline defaults without a config file", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-config-"));
    const config = loadConfig(cwd);
    await rm(cwd, { recursive: true, force: true });

    expect(config.project.safe_mode).toBe(true);
    expect(config.project.access_mode).toBe("partial");
    expect(config.project.telemetry).toBe(false);
    expect(config.orchestration.backend).toBe("native");
    expect(config.orchestration.langgraph.enabled).toBe(false);
    expect(config.providers.mock.enabled).toBe(true);
    expect(config.providers.openrouter.enabled).toBe(false);
  });

  it("does not overwrite an existing config unless force is explicit", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-config-"));
    try {
      const configPath = getConfigPath(cwd);
      await writeDefaultConfig(cwd);
      await writeFile(configPath, "project:\n  name: custom-project\n", "utf8");

      const skipped = await writeDefaultConfig(cwd);
      expect(skipped).toMatchObject({ created: false, overwritten: false });
      expect(await readFile(configPath, "utf8")).toContain("custom-project");

      const forced = await writeDefaultConfig(cwd, { force: true });
      expect(forced).toMatchObject({ created: false, overwritten: true });
      expect(await readFile(configPath, "utf8")).toContain("tomorrowedge");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
