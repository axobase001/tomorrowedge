import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";
import { saveSession } from "../../src/core/memory/sessionMemory.js";
import { readLearnedTaskMemory } from "../../src/core/memory/taskMemory.js";

describe("learned task memory", () => {
  it("records compact reusable task metadata when a session is saved", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-task-memory-"));
    try {
      const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig);
      await saveSession(cwd, state);
      const records = await readLearnedTaskMemory(cwd);

      expect(records[0]?.taskType).toBe("test");
      expect(records[0]?.routingMode).toBe("balanced");
      expect(records[0]?.verificationCommands).toContain("npm test");
      expect(records[0]?.goalFingerprint).toMatch(/^[0-9a-f]+$/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
