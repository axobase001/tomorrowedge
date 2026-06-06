import { describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseServePort } from "../../src/cli/commands/serve.js";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";
import { saveSession } from "../../src/core/memory/sessionMemory.js";
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
      expect(html).toContain("TomorrowEdge GUI Client");
      expect(html).toContain("Trace Ledger");
      expect(html).toContain("metric-line");
      expect(html).not.toContain("telemetry-table");
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

  it("serves the shared cockpit view model for a saved session", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-vm-"));
    const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });
    await saveSession(cwd, state);
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const vm = await fetch(`${server.url}/api/sessions/latest/view-model?nonce=${server.nonce}`).then((response) => response.json()) as { workflow: Array<{ label: string }>; currentApproval?: { kind: string } };

      expect(vm.workflow.map((step) => step.label)).toEqual(["Plan", "Route", "Edit", "Review", "Test", "Judge", "Approve"]);
      expect(vm.currentApproval?.kind).toBe("patch");
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("executes browser approval actions through the Node cockpit", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-approval-"));
    await cp(path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic"), cwd, { recursive: true });
    const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });
    await saveSession(cwd, state);
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/approvals?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId, action: "approve_patch", approvalId: "patch:fixture_candidate_a" })
      });
      const payload = await response.json() as { status: string; intent: { action: string }; viewModel: { currentApproval?: { kind: string }; main: { filesChanged: string[] } } };

      expect(response.status).toBe(200);
      expect(payload.status).toBe("applied");
      expect(payload.intent.action).toBe("approve_patch");
      expect(payload.viewModel.currentApproval?.kind).toBe("shell");
      expect(payload.viewModel.main.filesChanged).toContain("index.js");
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("returns invalid_json for malformed JSON request bodies", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-json-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/runs?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json"
      });
      const payload = await response.json() as { error: string };

      expect(response.status).toBe(400);
      expect(payload.error).toBe("invalid_json");
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects multibyte invalid cockpit tokens without throwing", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-token-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const badNonce = encodeURIComponent(`${server.nonce.slice(0, -1)}好`);
      const response = await fetch(`${server.url}/api/sessions?nonce=${badNonce}`);

      expect(response.status).toBe(403);
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

  it("rejects cross-origin mutating API requests", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-origin-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/runs?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://evil.example" },
        body: JSON.stringify({ goal: "fix failing test" })
      });

      expect(response.status).toBe(403);
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

  it("redacts artifact content returned through the local API", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-redact-"));
    const sessionDir = path.join(cwd, ".tomorrowedge", "sessions", "session_api_redact", "artifacts", "stdout");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(path.join(sessionDir, "secret.txt"), "OPENAI_API_KEY=sk-123456789012345678901234", "utf8");
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const text = await fetch(`${server.url}/api/sessions/session_api_redact/artifacts/artifacts/stdout/secret.txt?nonce=${server.nonce}`).then((response) => response.text());

      expect(text).toContain("[redacted]");
      expect(text).not.toContain("sk-");
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
