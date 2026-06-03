import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadProjectPreferences, saveProjectPreferences } from "../../src/core/memory/preferences.js";
import { prefsCommand } from "../../src/cli/commands/prefs.js";
import { modeCommand } from "../../src/cli/commands/mode.js";

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

  it("prints available preference keys instead of silent empty JSON", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-prefs-"));
    try {
      const output = await captureStdout(() => prefsCommand(cwd, { listKeys: true }));

      expect(output).toContain("TomorrowEdge project preferences");
      expect(output).toContain("Available keys");
      expect(output).toContain("accessMode");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("syncs mode command writes into preferences so stale prefs cannot override it", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-prefs-"));
    try {
      await saveProjectPreferences(cwd, { accessMode: "restricted" });
      await captureStdout(() => modeCommand(cwd, "full"));

      expect(loadProjectPreferences(cwd).accessMode).toBe("full");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }
  return output;
}
