import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig, writeConfig, writeDefaultConfig } from "../../src/config/configLoader.js";
import { defaultConfig } from "../../src/config/defaultConfig.js";

describe("config loader", () => {
  it("loads safe offline defaults without a config file", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-config-"));
    const config = loadConfig(cwd);
    await rm(cwd, { recursive: true, force: true });

    expect(config.project.safe_mode).toBe(true);
    expect(config.project.access_mode).toBe("partial");
    expect(config.project.telemetry).toBe(false);
    expect(config.providers.mock.enabled).toBe(true);
    expect(config.providers.openrouter.enabled).toBe(false);
  });

  it("does not overwrite an existing config unless force is explicit", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-config-"));
    try {
      await writeConfig(cwd, { ...defaultConfig, project: { ...defaultConfig.project, access_mode: "full" } });
      await expect(writeDefaultConfig(cwd)).rejects.toThrow("Config already exists");
      expect(loadConfig(cwd).project.access_mode).toBe("full");

      await writeDefaultConfig(cwd, { force: true });
      expect(loadConfig(cwd).project.access_mode).toBe("partial");
      expect(await readFile(path.join(cwd, ".tomorrowedge", "config.yaml"), "utf8")).toContain("access_mode: partial");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
