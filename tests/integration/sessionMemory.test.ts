import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";
import { listSessions, loadLatestSession, saveSession } from "../../src/core/memory/sessionMemory.js";
import { exportCommand } from "../../src/cli/commands/export.js";
import type { TomorrowEdgeEvent } from "../../src/core/events/eventTypes.js";

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

  it("redacts provider metadata before persistence, loading, and JSON export", async () => {
    const state = await runOfflineGraph(tempRoot, "persist provider error safely", defaultConfig);
    state.modelNotes.push({
      id: "note_provider_error",
      role: "planner",
      provider: "openrouter",
      model: "free-test-model",
      kind: "plan_advice",
      content: "",
      error: '{"request_id":"req_live_456","org_id":"org_live_789","accountId":"acct_live_123","x-ratelimit-reset":"1712345678"}'
    });
    state.events.push({
      id: "event_provider_error",
      timestamp: new Date().toISOString(),
      sessionId: state.sessionId,
      mode: state.access.mode,
      type: "model_call",
      status: "failure",
      phase: "planning",
      role: "planner",
      provider: "openrouter",
      model: "free-test-model",
      requestId: "req_live_event",
      error: '{"request_id":"req_live_456","org_id":"org_live_789","accountId":"acct_live_123"}'
    } as TomorrowEdgeEvent);
    state.eventArtifacts.push({
      ref: "artifacts/responses/provider-error.txt",
      content: '{"request_id":"req_live_artifact","org_id":"org_live_artifact","accountId":"acct_live_artifact","x-ratelimit-reset":"1712345678"}'
    });

    const sessionPath = await saveSession(tempRoot, state);
    const sessionDir = path.dirname(sessionPath);
    const persisted = [
      await readFile(sessionPath, "utf8"),
      await readFile(path.join(sessionDir, "events.jsonl"), "utf8"),
      await readFile(path.join(sessionDir, "artifacts/responses/provider-error.txt"), "utf8")
    ].join("\n");
    const loaded = JSON.stringify(await loadLatestSession(tempRoot));
    const exported = await captureStdout(() => exportCommand(tempRoot, "latest", { format: "json", includeArtifacts: true }));

    for (const text of [persisted, loaded, exported]) {
      expect(text).not.toContain("req_live_456");
      expect(text).not.toContain("req_live_event");
      expect(text).not.toContain("req_live_artifact");
      expect(text).not.toContain("org_live_789");
      expect(text).not.toContain("org_live_artifact");
      expect(text).not.toContain("acct_live_123");
      expect(text).not.toContain("acct_live_artifact");
      expect(text).toContain("x-ratelimit-reset");
      expect(text).toContain("1712345678");
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
