import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";
import { listSessions, loadLatestSession, saveSession } from "../../src/core/memory/sessionMemory.js";

describe("session memory", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "tedge-session-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("lists sessions and loads latest", async () => {
    const first = await runOfflineGraph(tempRoot, "first task", defaultConfig);
    await saveSession(tempRoot, first);
    const second = await runOfflineGraph(tempRoot, "second task", defaultConfig);
    await saveSession(tempRoot, second);

    const sessions = await listSessions(tempRoot);
    expect(sessions.length).toBe(2);
    expect((await loadLatestSession(tempRoot)).state.goal).toBe("second task");
  });
});
