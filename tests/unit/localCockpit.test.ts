import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startLocalCockpitServer } from "../../src/localCockpit/server.js";

describe("local cockpit server", () => {
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
});
