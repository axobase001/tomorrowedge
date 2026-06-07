import { describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    const server = await startLocalCockpitServer(cwd, { port: 0, webRoot: false });
    try {
      const health = await fetch(`${server.url}/health`).then((response) => response.json()) as { ok: boolean };
      const html = await fetch(server.url).then((response) => response.text());
      const icon = await fetch(`${server.url}/icon.svg`).then((response) => response.text());
      const manifest = await fetch(`${server.url}/manifest.webmanifest`).then((response) => response.json()) as { name: string; icons: Array<{ src: string }> };
      const sessions = await fetch(`${server.url}/api/sessions?nonce=${server.nonce}`).then((response) => response.json()) as unknown[];

      expect(health.ok).toBe(true);
      expect(html).toContain("TomorrowEdge GUI Client");
      expect(html).toContain('href="/icon.svg"');
      expect(html).toContain('href="/manifest.webmanifest"');
      expect(html).toContain("mark-top");
      expect(icon).toContain("TomorrowEdge");
      expect(icon).toContain("#d81f0d");
      expect(manifest.name).toBe("TomorrowEdge GUI Client");
      expect(manifest.icons[0]?.src).toBe("/icon.svg");
      expect(html).toContain("Trace Ledger");
      expect(html).toContain("metric-line");
      expect(html).toContain("@media (max-width: 860px)");
      expect(html).toContain(".cockpit-shell {\n    min-width: 0;");
      expect(html).toContain("grid-template-columns: minmax(0, 1fr);");
      expect(html).toContain('event.key !== "Enter"');
      expect(html).toContain("event.shiftKey");
      expect(html).toContain("event.isComposing");
      expect(html).not.toContain("telemetry-table");
      expect(sessions).toEqual([]);
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("serves the React cockpit build when web assets are available", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-react-"));
    const webRoot = path.join(cwd, "dist", "cockpit-web");
    await mkdir(path.join(webRoot, "assets"), { recursive: true });
    await writeFile(path.join(webRoot, "index.html"), '<!doctype html><div id="root" data-react-cockpit="true"></div><script type="module" src="/assets/app.js"></script>', "utf8");
    await writeFile(path.join(webRoot, "assets", "app.js"), "window.__tomorrowedgeCockpit = true;", "utf8");
    const server = await startLocalCockpitServer(cwd, { port: 0, webRoot });
    try {
      const html = await fetch(server.url).then((response) => response.text());
      const asset = await fetch(`${server.url}/assets/app.js`);

      expect(html).toContain('data-react-cockpit="true"');
      expect(html).toContain('/assets/app.js');
      expect(await asset.text()).toContain("__tomorrowedgeCockpit");
      expect(asset.headers.get("content-type")).toContain("text/javascript");
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

  it("rejects stale patch approval ids before applying a patch", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-stale-patch-"));
    await cp(path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic"), cwd, { recursive: true });
    const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });
    await saveSession(cwd, state);
    const before = await readFile(path.join(cwd, "index.js"), "utf8");
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/approvals?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId, action: "approve_patch", approvalId: "patch:not-current" })
      });
      const payload = await response.json() as { error: string };
      const after = await readFile(path.join(cwd, "index.js"), "utf8");

      expect(response.status).toBe(409);
      expect(payload.error).toBe("approval_mismatch");
      expect(after).toBe(before);
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects stale shell approval ids before running verification", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-stale-shell-"));
    await cp(path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic"), cwd, { recursive: true });
    const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });
    await saveSession(cwd, state);
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const vm = await fetch(`${server.url}/api/sessions/${state.sessionId}/view-model?nonce=${server.nonce}`).then((response) => response.json()) as { currentApproval?: { id: string } };
      await fetch(`${server.url}/api/approvals?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId, action: "approve_patch", approvalId: vm.currentApproval?.id })
      });
      const response = await fetch(`${server.url}/api/approvals?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId, action: "approve_shell", approvalId: "shell:not-current" })
      });
      const payload = await response.json() as { error: string };
      const after = await fetch(`${server.url}/api/sessions/${state.sessionId}/view-model?nonce=${server.nonce}`).then((item) => item.json()) as { main: { testStatus?: string }; rawEvents: Array<{ type: string }> };

      expect(response.status).toBe(409);
      expect(payload.error).toBe("approval_mismatch");
      expect(after.main.testStatus).toBe("not_run");
      expect(after.rawEvents.some((event) => event.type === "shell_run")).toBe(false);
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("requires the active approval id before executing patch approvals", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-approval-id-"));
    await cp(path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic"), cwd, { recursive: true });
    const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });
    await saveSession(cwd, state);
    const before = await readFile(path.join(cwd, "index.js"), "utf8");
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/approvals?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId, action: "approve_patch" })
      });
      const payload = await response.json() as { error: string };
      const after = await readFile(path.join(cwd, "index.js"), "utf8");

      expect(response.status).toBe(400);
      expect(payload.error).toBe("approval_id_required");
      expect(after).toBe(before);
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

  it("rejects invalid access modes before starting browser runs", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-access-mode-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/runs?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: "fix failing test", accessMode: "totally-open" })
      });
      const payload = await response.json() as { error: string };

      expect(response.status).toBe(400);
      expect(payload.error).toBe("invalid_access_mode");
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

  it("rejects non-artifact refs through the artifact endpoint", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-artifact-prefix-"));
    const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });
    await saveSession(cwd, state);
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/sessions/${state.sessionId}/artifacts/events.jsonl?nonce=${server.nonce}`);
      const payload = await response.json() as { error: string };

      expect(response.status).toBe(400);
      expect(payload.error).toBe("invalid artifact ref");
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

  it("requires an active session for MCP registrations", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-mcp-session-required-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/mcp/register?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "codex", name: "Codex", allowedRoles: ["reviewer"] })
      });
      const payload = await response.json() as { error: string };

      expect(response.status).toBe(400);
      expect(payload.error).toBe("session_id_required");
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("records MCP registrations in the requested active session", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-mcp-session-"));
    const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });
    await saveSession(cwd, state);
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/mcp/register?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: state.sessionId,
          id: "codex",
          name: "Codex",
          capabilities: ["code_review"],
          allowedRoles: ["reviewer"],
          trustLevel: "low"
        })
      });
      const payload = await response.json() as { sessionId?: string; profile?: { id?: string; allowedRoles?: string[] } };
      const events = await fetch(`${server.url}/api/sessions/${state.sessionId}/events?nonce=${server.nonce}`).then((item) => item.json()) as Array<{ type: string; externalAgentId?: string }>;

      expect(response.status).toBe(200);
      expect(payload.sessionId).toBe(state.sessionId);
      expect(payload.profile?.id).toBe("codex");
      expect(payload.profile?.allowedRoles).toEqual(["reviewer"]);
      expect(events.some((event) => event.type === "external_agent_registered" && event.externalAgentId === "codex")).toBe(true);
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
