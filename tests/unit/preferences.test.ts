import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
});
