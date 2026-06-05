import { mkdtemp, readFile, rm } from "node:fs/promises";
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

  it("redacts session records and artifacts before writing to disk", async () => {
    const state = await runOfflineGraph(tempRoot, "redaction task", defaultConfig);
    state.events.push({
      id: "event_redaction",
      timestamp: new Date().toISOString(),
      sessionId: state.sessionId,
      mode: state.access.mode,
      phase: "routing",
      type: "provider_fallback",
      fromProvider: "openrouter",
      fromModel: "demo",
      toProvider: "fixture",
      toModel: "fixture",
      reason: '429 {"user_id":"user_3EfqcfPXAjQTwahh8KSxAxJJYP9"}'
    });
    state.eventArtifacts.push({
      ref: "artifacts/provider/error.txt",
      content: "OPENAI_API_KEY=sk-123456789012345678901234"
    });

    const sessionPath = await saveSession(tempRoot, state);
    const sessionText = await readFile(sessionPath, "utf8");
    const eventsText = await readFile(path.join(path.dirname(sessionPath), "events.jsonl"), "utf8");
    const artifactText = await readFile(path.join(path.dirname(sessionPath), "artifacts/provider/error.txt"), "utf8");

    expect(sessionText).not.toContain("user_3EfqcfPXAjQTwahh8KSxAxJJYP9");
    expect(eventsText).not.toContain("user_3EfqcfPXAjQTwahh8KSxAxJJYP9");
    expect(artifactText).not.toContain("sk-");
  });
});
