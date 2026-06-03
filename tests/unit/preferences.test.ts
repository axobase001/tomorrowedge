import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { modeCommand } from "../../src/cli/commands/mode.js";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { writeConfig } from "../../src/config/configLoader.js";
import { loadProjectPreferences, saveProjectPreferences } from "../../src/core/memory/preferences.js";

describe("project preferences", () => {
  it("round-trips local preferences", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-prefs-"));
    try {
      expect(loadProjectPreferences(cwd)).toEqual({});
      await saveProjectPreferences(cwd, {
        accessMode: "restricted",
        routingMode: "privacy",
        preferredTestCommand: "npm test",
        preferredLivePatch: true
      });

      expect(loadProjectPreferences(cwd)).toMatchObject({
        accessMode: "restricted",
        routingMode: "privacy",
        preferredTestCommand: "npm test",
        preferredLivePatch: true
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("syncs access mode preferences when mode command is used", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-prefs-mode-"));
    try {
      await writeConfig(cwd, defaultConfig);
      await saveProjectPreferences(cwd, { accessMode: "full" });
      await modeCommand(cwd, "restricted");

      expect(loadProjectPreferences(cwd).accessMode).toBe("restricted");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
