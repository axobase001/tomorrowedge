import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseServePort } from "../../src/cli/commands/serve.js";
import { startLocalCockpitServer } from "../../src/localCockpit/server.js";

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
      const sessions = await fetch(`${server.url}/api/sessions?nonce=${server.nonce}`).then((response) => response.json()) as unknown[];

      expect(health.ok).toBe(true);
      expect(html).toContain("TomorrowEdge / 明日边缘");
      expect(html).toContain("Trace Ledger");
      expect(sessions).toEqual([]);
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("requires the local cockpit token for API routes", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-auth-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const denied = await fetch(`${server.url}/api/sessions`);
      const allowed = await fetch(`${server.url}/api/sessions`, { headers: { "x-tomorrowedge-token": server.nonce } });

      expect(denied.status).toBe(403);
      expect(allowed.status).toBe(200);
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects oversized JSON request bodies", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-body-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-tomorrowedge-token": server.nonce },
        body: JSON.stringify({ goal: "x".repeat(1_000_100) })
      });

      expect(response.status).toBe(413);
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects artifact path traversal and absolute refs", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-artifact-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const absoluteRef = encodeURIComponent(path.resolve(cwd, "outside.txt"));
      const response = await fetch(`${server.url}/api/sessions/session_test/artifacts/${absoluteRef}?nonce=${server.nonce}`);

      expect(response.status).toBe(400);
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
});
