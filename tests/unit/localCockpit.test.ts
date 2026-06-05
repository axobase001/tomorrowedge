import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseServePort } from "../../src/cli/commands/serve.js";
import { startLocalCockpitServer } from "../../src/localCockpit/server.js";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";
import { saveSession } from "../../src/core/memory/sessionMemory.js";
import type { TomorrowEdgeEvent } from "../../src/core/events/eventTypes.js";

describe("local cockpit server", () => {
  it("accepts port 0 in CLI port parsing for OS-assigned ports", () => {
    expect(parseServePort("0")).toBe(0);
    expect(parseServePort(undefined)).toBe(18792);
    expect(() => parseServePort("-1")).toThrow("Invalid port");
  });

  it("serves the cockpit shell and health endpoint", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const health = await fetch(`${server.url}/health`).then((response) => response.json()) as { ok: boolean };
      const html = await fetch(server.url).then((response) => response.text());
      const sessions = await fetch(`${server.url}/api/sessions`).then((response) => response.json()) as unknown[];

      expect(health.ok).toBe(true);
      expect(html).toContain("TomorrowEdge / 明日边缘");
      expect(html).toContain("Trace Ledger");
      expect(sessions).toEqual([]);
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("falls forward when the requested port is already in use", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-port-"));
    const first = await startLocalCockpitServer(cwd, { port: 0 });
    const occupiedPort = new URL(first.url).port;
    const second = await startLocalCockpitServer(cwd, { port: Number(occupiedPort) });
    try {
      expect(second.url).not.toBe(first.url);
      expect(second.requestedPort).toBe(Number(occupiedPort));
      expect(second.port).not.toBe(Number(occupiedPort));
      const health = await fetch(`${second.url}/health`).then((response) => response.json()) as { ok: boolean };
      expect(health.ok).toBe(true);
    } finally {
      await second.close();
      await first.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("redacts saved provider metadata from session and artifact APIs", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-redact-"));
    const state = await runOfflineGraph(cwd, "serve provider error safely", defaultConfig);
    state.modelNotes.push({
      id: "note_provider_error",
      role: "planner",
      provider: "openrouter",
      model: "free-test-model",
      kind: "plan_advice",
      content: "",
      error: '{"request_id":"req_live_456","org_id":"org_live_789","accountId":"acct_live_123"}'
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
    const artifactRef = "artifacts/responses/provider-error.txt";
    state.eventArtifacts.push({
      ref: artifactRef,
      content: '{"request_id":"req_live_artifact","org_id":"org_live_artifact","accountId":"acct_live_artifact","x-ratelimit-reset":"1712345678"}'
    });
    await saveSession(cwd, state);
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const session = await fetch(`${server.url}/api/sessions/latest`).then((response) => response.text());
      const events = await fetch(`${server.url}/api/sessions/latest/events`).then((response) => response.text());
      const artifact = await fetch(`${server.url}/api/sessions/latest/artifacts/${encodeURIComponent(artifactRef)}`).then((response) => response.text());
      const payload = [session, events, artifact].join("\n");

      expect(payload).not.toContain("req_live_456");
      expect(payload).not.toContain("req_live_event");
      expect(payload).not.toContain("req_live_artifact");
      expect(payload).not.toContain("org_live_789");
      expect(payload).not.toContain("org_live_artifact");
      expect(payload).not.toContain("acct_live_123");
      expect(payload).not.toContain("acct_live_artifact");
      expect(payload).toContain("x-ratelimit-reset");
      expect(payload).toContain("1712345678");
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
