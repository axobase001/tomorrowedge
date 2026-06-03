import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../src/config/configLoader.js";

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
});
