import { describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseServePort } from "../../src/cli/commands/serve.js";
import { loadConfig, writeConfig } from "../../src/config/configLoader.js";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";
import { createConversationSession } from "../../src/core/conversation/conversationSession.js";
import { saveSession } from "../../src/core/memory/sessionMemory.js";
import { markLiveRunFailed, startLocalCockpitServer } from "../../src/localCockpit/server.js";
import { clearCockpitProviderModelCache, listCockpitProviderModels } from "../../src/localCockpit/setup.js";

async function withEnvOverrides<T>(overrides: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

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
      const shell = await fetch(server.url);
      const html = await shell.text();
      const icon = await fetch(`${server.url}/icon.svg`).then((response) => response.text());
      const manifest = await fetch(`${server.url}/manifest.webmanifest`).then((response) => response.json()) as { name: string; icons: Array<{ src: string }> };
      const sessions = await fetch(`${server.url}/api/sessions?nonce=${server.nonce}`).then((response) => response.json()) as unknown[];
      const cookieSessions = await fetch(`${server.url}/api/sessions`, { headers: { cookie: shell.headers.get("set-cookie") ?? "" } }).then((response) => response.json()) as unknown[];

      expect(server.openUrl).toBe(server.url);
      expect(server.openUrl).not.toContain("nonce=");
      expect(health.ok).toBe(true);
      expect(html).toContain("TomorrowEdge GUI Client");
      expect(html).toContain('<html lang="en">');
      expect(html).toContain("__TOMORROWEDGE_COCKPIT__");
      expect(html).not.toContain('searchParams.get("nonce")');
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
      expect(html).toContain('id="stop-run"');
      expect(html).toContain('id="full-preflight"');
      expect(html).toContain('/api/runs/" + encodeURIComponent(sessionId) + "/cancel');
      expect(html).not.toContain("telemetry-table");
      expect(sessions).toEqual([]);
      expect(cookieSessions).toEqual([]);
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("serves the React cockpit build when web assets are available", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-react-"));
    const webRoot = path.join(cwd, "dist", "cockpit-web");
    await mkdir(path.join(webRoot, "assets"), { recursive: true });
    await writeFile(path.join(webRoot, "index.html"), '<!doctype html><div id="root" data-react-cockpit="true"></div><script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css">', "utf8");
    await writeFile(path.join(webRoot, "assets", "app.js"), "window.__tomorrowedgeCockpit = true;", "utf8");
    await writeFile(path.join(webRoot, "assets", "app.css"), ".te-shell { display: grid; }", "utf8");
    const server = await startLocalCockpitServer(cwd, { port: 0, webRoot });
    try {
      const html = await fetch(server.url).then((response) => response.text());
      const asset = await fetch(`${server.url}/assets/app.js`);
      const style = await fetch(`${server.url}/assets/app.css`);

      expect(html).toContain('data-react-cockpit="true"');
      expect(html).toContain('/assets/app.js');
      expect(html).toContain('/assets/app.css');
      expect(await asset.text()).toContain("__tomorrowedgeCockpit");
      expect(asset.headers.get("content-type")).toContain("text/javascript");
      expect(await style.text()).toContain(".te-shell");
      expect(style.headers.get("content-type")).toContain("text/css");
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("falls back when the React cockpit stylesheet is incomplete", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-stale-css-"));
    const webRoot = path.join(cwd, "dist", "cockpit-web");
    await mkdir(path.join(webRoot, "assets"), { recursive: true });
    await writeFile(path.join(webRoot, "index.html"), '<!doctype html><div id="root" data-stale-react-cockpit="true"></div><script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css">', "utf8");
    await writeFile(path.join(webRoot, "assets", "app.js"), "window.__tomorrowedgeCockpit = true;", "utf8");
    await writeFile(path.join(webRoot, "assets", "app.css"), ":root { --te-bg: #f6fafc; }", "utf8");
    const server = await startLocalCockpitServer(cwd, { port: 0, webRoot });
    try {
      const html = await fetch(server.url).then((response) => response.text());

      expect(html).toContain("TomorrowEdge GUI Client");
      expect(html).not.toContain('data-stale-react-cockpit="true"');
    } finally {
      await server.close();
      await unlink(path.join(webRoot, "index.html"));
      await unlink(path.join(webRoot, "assets", "app.js"));
      await unlink(path.join(webRoot, "assets", "app.css"));
      await rmdir(path.join(webRoot, "assets"));
      await rmdir(webRoot);
      await rmdir(path.join(cwd, "dist"));
      await rmdir(cwd);
    }
  });

  it("does not serve the Vite source cockpit index as static browser assets", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-vite-source-"));
    const webRoot = path.join(cwd, "src", "cockpit-web");
    await mkdir(webRoot, { recursive: true });
    await writeFile(path.join(webRoot, "index.html"), '<!doctype html><div id="root"></div><script type="module" src="/src/main.tsx"></script>', "utf8");
    const server = await startLocalCockpitServer(cwd, { port: 0, webRoot });
    try {
      const html = await fetch(server.url).then((response) => response.text());

      expect(html).toContain("TomorrowEdge GUI Client");
      expect(html).not.toContain("/src/main.tsx");
    } finally {
      await server.close();
      await unlink(path.join(webRoot, "index.html"));
      await rmdir(webRoot);
      await rmdir(path.join(cwd, "src"));
      await rmdir(cwd);
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
    await cp(path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic"), cwd, { recursive: true });
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

  it("records follow-up messages in the selected saved session", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-continuation-"));
    const state = createConversationSession({ message: "summarize this repository", target: "core", config: defaultConfig });
    await saveSession(cwd, state);
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const empty = await fetch(`${server.url}/api/sessions/${state.sessionId}/messages?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "   " })
      });
      const emptyPayload = await empty.json() as { error: string };

      expect(empty.status).toBe(400);
      expect(emptyPayload.error).toBe("message_required");

      const response = await fetch(`${server.url}/api/sessions/${state.sessionId}/messages?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "please continue from the previous summary", target: "reviewer" })
      });
      const payload = await response.json() as { sessionId: string; status: string; turnId: string; contextArtifactRef: string; viewModel: { sessionId: string; conversation: Array<{ speaker: string; continuation: boolean; summary: string }>; rawEvents: Array<{ type: string; policySummary?: string }> } };
      const reloaded = await fetch(`${server.url}/api/sessions/${state.sessionId}/view-model?nonce=${server.nonce}`).then((item) => item.json()) as typeof payload.viewModel;
      const context = await fetch(`${server.url}/api/sessions/${state.sessionId}/artifacts/${encodeURIComponent(payload.contextArtifactRef)}?nonce=${server.nonce}`).then((item) => item.text());

      expect(response.status).toBe(200);
      expect(payload.status).toBe("recorded");
      expect(payload.sessionId).toBe(state.sessionId);
      expect(payload.turnId).toMatch(/^turn_/);
      expect(payload.contextArtifactRef).toContain("artifacts/context_projection/");
      expect(payload.viewModel.conversation).toContainEqual(expect.objectContaining({
        speaker: "user",
        continuation: true,
        summary: expect.stringContaining("please continue")
      }));
      expect(payload.viewModel.rawEvents).toContainEqual(expect.objectContaining({
        type: "context_projection",
        policySummary: expect.stringContaining("bounded")
      }));
      expect(reloaded.conversation.length).toBe(payload.viewModel.conversation.length);
      expect(context).toContain("Session Continuation Context");
      expect(context).toContain("please continue from the previous summary");
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("runs follow-up messages in the same saved session when requested", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-followup-run-"));
    const state = createConversationSession({ message: "summarize this repository", target: "core", config: defaultConfig });
    await saveSession(cwd, state);
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/sessions/${state.sessionId}/messages?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "now turn that summary into an implementation plan",
          target: "planner",
          mode: "followup_run",
          runMode: "fixture",
          accessMode: "restricted"
        })
      });
      const payload = await response.json() as { sessionId: string; status: string; turnId: string; contextArtifactRef: string; viewModel: { sessionId: string } };
      const reloaded = await waitForSessionEventCount(server.url, server.nonce, state.sessionId, state.events.length + 6);

      expect(response.status).toBe(202);
      expect(payload.status).toBe("started");
      expect(payload.sessionId).toBe(state.sessionId);
      expect(payload.viewModel.sessionId).toBe(state.sessionId);
      expect(reloaded.state.sessionId).toBe(state.sessionId);
      expect(reloaded.state.events).toContainEqual(expect.objectContaining({
        type: "context_projection",
        policySummary: expect.stringContaining("dispatching")
      }));
      expect(reloaded.state.events.some((event) => event.type === "access_mode")).toBe(true);
      expect(reloaded.state.finalSummary?.evidence[0]).toContain(`Continuation turn ${payload.turnId}`);
      expect(reloaded.state.finalSummary?.evidence[0]).toContain(payload.contextArtifactRef);
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("renames and deletes saved sessions through the local cockpit API", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-session-manage-"));
    await cp(path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic"), cwd, { recursive: true });
    const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });
    await saveSession(cwd, state);
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const rename = await fetch(`${server.url}/api/sessions/${state.sessionId}?nonce=${server.nonce}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: "renamed smoke session" })
      });
      const renamed = await rename.json() as { goal: string; viewModel?: { goal: string } };
      const afterRename = await fetch(`${server.url}/api/sessions/${state.sessionId}?nonce=${server.nonce}`).then((response) => response.json()) as { state: { goal: string } };

      expect(rename.status).toBe(200);
      expect(renamed.goal).toBe("renamed smoke session");
      expect(renamed.viewModel?.goal).toBe("renamed smoke session");
      expect(afterRename.state.goal).toBe("renamed smoke session");

      const missingConfirmation = await fetch(`${server.url}/api/sessions/${state.sessionId}?nonce=${server.nonce}`, { method: "DELETE" });
      const confirmationError = await missingConfirmation.json() as { error: string };
      const deleted = await fetch(`${server.url}/api/sessions/${state.sessionId}?nonce=${server.nonce}&confirmed=true`, { method: "DELETE" });
      const sessions = await deleted.json() as Array<{ sessionId: string }>;
      const missing = await fetch(`${server.url}/api/sessions/${state.sessionId}?nonce=${server.nonce}`);

      expect(missingConfirmation.status).toBe(400);
      expect(confirmationError.error).toBe("delete_session_confirmation_required");
      expect(deleted.status).toBe(200);
      expect(sessions.some((session) => session.sessionId === state.sessionId)).toBe(false);
      expect(missing.status).toBe(404);
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("preserves accumulated live events when a run fails", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-failed-live-"));
    try {
      const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });
      const failed = markLiveRunFailed({ ...state, finalSummary: undefined }, "provider exploded");

      expect(failed.events.length).toBe(state.events.length);
      expect(failed.candidates.length).toBe(state.candidates.length);
      expect(failed.runResults.length).toBe(state.runResults.length);
      expect(failed.finalSummary?.result).toBe("failed");
      expect(failed.finalSummary?.risksRemaining).toContain("provider exploded");
      expect(failed.finalSummary?.evidence[0]).toContain("event(s) recorded");
    } finally {
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
      const payload = await response.json() as { status: string; intent: { action: string }; viewModel: { currentApproval?: { id: string; kind: string }; main: { filesChanged: string[] } } };

      expect(response.status).toBe(200);
      expect(payload.status).toBe("applied");
      expect(payload.intent.action).toBe("approve_patch");
      expect(payload.viewModel.currentApproval?.kind).toBe("shell");
      expect(payload.viewModel.main.filesChanged).toContain("index.js");

      const shellResponse = await fetch(`${server.url}/api/approvals?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId, action: "approve_shell", approvalId: payload.viewModel.currentApproval?.id })
      });
      const shellPayload = await shellResponse.json() as { viewModel: { objectiveTrace?: { outcomeStatus?: string }; rawEvents: Array<{ type: string; result?: string; applied?: boolean; success?: boolean }> } };

      expect(shellResponse.status).toBe(200);
      expect(shellPayload.viewModel.objectiveTrace?.outcomeStatus).toBe("success");
      expect(shellPayload.viewModel.rawEvents.some((event) => event.type === "patch_apply" && event.applied)).toBe(true);
      expect(shellPayload.viewModel.rawEvents.some((event) => event.type === "shell_run" && event.success)).toBe(true);
      expect(shellPayload.viewModel.rawEvents.some((event) => event.type === "workflow_stop_reason" && event.result === "completed")).toBe(true);
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("clears shell approval when no verification command is available", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-no-shell-command-"));
    await cp(path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic"), cwd, { recursive: true });
    const state = await runOfflineGraph(cwd, "write a markdown delivery only without runnable verification", defaultConfig, { fixtureMode: true });
    const patchedState = {
      ...state,
      changedFiles: ["docs/report.md"],
      runResults: [],
      plan: state.plan ? {
        ...state.plan,
        verificationCommands: []
      } : state.plan,
      approvals: { ...state.approvals, patchApproved: true, shellApproved: false },
      finalSummary: {
        task: state.goal,
        result: "partially_completed" as const,
        userReply: "Patch applied but shell verification is still pending.",
        userReplySource: "model",
        changedFiles: ["docs/report.md"],
        testsRun: [],
        evidence: ["patch applied"],
        risksRemaining: ["shell verification pending"],
        suggestedCommitMessage: "docs: add report"
      }
    };
    await saveSession(cwd, patchedState);
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/approvals?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId, action: "approve_shell", approvalId: "shell:test" })
      });
      const payload = await response.json() as {
        message: string;
        viewModel: {
          currentApproval?: { id: string };
          rawEvents: Array<{ type: string; skipped?: boolean; skipReason?: string }>;
          approvalHistory: Array<{ action: string; kind: string; summary: string }>;
        };
      };

      expect(response.status).toBe(200);
      expect(payload.message).toBe("No verification command is available.");
      expect(payload.viewModel.currentApproval).toBeUndefined();
      expect(payload.viewModel.rawEvents.some((event) => event.type === "shell_run" && event.skipped === true && event.skipReason === "no verification command available")).toBe(true);
      expect(payload.viewModel.approvalHistory).toContainEqual(expect.objectContaining({
        action: "approved",
        kind: "shell"
      }));
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("completes report-style approvals with structural deliverable verification", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-report-structural-"));
    await cp(path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic"), cwd, { recursive: true });
    await mkdir(path.join(cwd, "docs"), { recursive: true });
    await writeFile(path.join(cwd, "docs", "report.md"), "# Benchmark report\n\nEvidence collected.\n", "utf8");
    const state = await runOfflineGraph(cwd, "write a markdown benchmark report", defaultConfig, { fixtureMode: true });
    await saveSession(cwd, {
      ...state,
      changedFiles: ["docs/report.md"],
      runResults: [],
      plan: state.plan ? {
        ...state.plan,
        taskType: "docs",
        verificationCommands: []
      } : state.plan,
      approvals: { ...state.approvals, patchApproved: true, shellApproved: false },
      finalSummary: {
        task: state.goal,
        result: "partially_completed",
        userReply: "Patch applied but shell verification is still pending.",
        userReplySource: "system",
        changedFiles: ["docs/report.md"],
        testsRun: [],
        evidence: ["patch applied"],
        risksRemaining: ["shell verification pending"],
        suggestedCommitMessage: "docs: add benchmark report"
      }
    });
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/approvals?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId, action: "approve_shell", approvalId: "shell:test" })
      });
      const payload = await response.json() as {
        message: string;
        viewModel: {
          main: { subtitle: string; body: string };
          rawEvents: Array<{ type: string; skipped?: boolean; skipReason?: string }>;
        };
      };

      expect(response.status).toBe(200);
      expect(payload.message).toContain("structural deliverable verification passed");
      expect(payload.viewModel.main.subtitle).toBe("completed");
      expect(payload.viewModel.main.body).toContain("structural document verifier");
      expect(payload.viewModel.rawEvents.some((event) => event.type === "shell_run" && event.skipped === true)).toBe(true);
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
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

  it("moves failed patch approvals out of waiting state and rejects repeat approves", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-patch-failure-"));
    await cp(path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic"), cwd, { recursive: true });
    const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });
    const brokenState = {
      ...state,
      candidates: state.candidates.map((candidate) => candidate.candidateId === "fixture_candidate_a" ? {
        ...candidate,
        unifiedDiff: `--- a/index.js
+++ b/index.js
@@ -1 +1 @@
-definitely-not-present
+replacement`
      } : candidate)
    };
    await saveSession(cwd, brokenState);
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const first = await fetch(`${server.url}/api/approvals?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId, action: "approve_patch", approvalId: "patch:fixture_candidate_a" })
      });
      const payload = await first.json() as { viewModel: { status: string; currentApproval?: unknown; main: { title: string; body: string } } };

      expect(first.status).toBe(200);
      expect(payload.viewModel.status).toBe("failed");
      expect(payload.viewModel.currentApproval).toBeUndefined();
      expect(payload.viewModel.main.title).toBe("Failure diagnosis");
      expect(payload.viewModel.main.body).toContain("Patch apply failed");

      const second = await fetch(`${server.url}/api/approvals?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId, action: "approve_patch", approvalId: "patch:fixture_candidate_a" })
      });
      const secondPayload = await second.json() as { error: string };

      expect(second.status).toBe(409);
      expect(secondPayload.error).toBe("no_active_approval");
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("clears the active patch approval when re-review is requested", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-rereview-"));
    await cp(path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic"), cwd, { recursive: true });
    const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });
    await saveSession(cwd, state);
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/approvals?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId, action: "request_re_review", feedback: "please review again" })
      });
      const payload = await response.json() as { viewModel: { currentApproval?: unknown; approvalHistory: Array<{ action: string }> } };

      expect(response.status).toBe(200);
      expect(payload.viewModel.currentApproval).toBeUndefined();
      expect(payload.viewModel.approvalHistory).toContainEqual(expect.objectContaining({
        action: "revision_requested"
      }));
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
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

  it("rejects invalid GUI run modes before starting browser runs", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-run-mode-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/runs?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: "fix failing test", runMode: "cloudish" })
      });
      const payload = await response.json() as { error: string };

      expect(response.status).toBe(400);
      expect(payload.error).toBe("invalid_run_mode");
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("can start a Sirius Agent Council run from the GUI API", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-council-run-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/runs?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: "rewrite this application in Rust", runMode: "council", accessMode: "full" })
      });
      expect(response.status).toBe(202);
      const session = await waitForLatestSession(server.url, server.nonce);

      expect(session.state.events.map((event) => event.type)).toEqual(expect.arrayContaining([
        "chief_agent_selected",
        "council_session_started",
        "council_consensus",
        "task_ownership_assignment",
        "chief_final_review"
      ]));
      expect(session.state.chiefAgent?.id).toBeTruthy();
      expect(session.state.council?.status).toBe("consensus");
      expect(session.state.finalSummary?.result).toBe("completed");
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("runs GUI fixture demos in an isolated sample workspace", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-isolated-fixture-"));
    await mkdir(path.join(cwd, "tests", "fixtures"), { recursive: true });
    await cp(path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic"), path.join(cwd, "tests", "fixtures", "sample-repo-basic"), { recursive: true });
    await writeFile(path.join(cwd, "package.json"), "{\"scripts\":{\"test\":\"node test.js\"}}\n", "utf8");
    await writeFile(path.join(cwd, "index.js"), "module.exports = { add: () => 'root should stay unchanged' };\n", "utf8");
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/runs?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: "fix failing test", runMode: "fixture", accessMode: "partial", approvePatch: true })
      });
      expect(response.status).toBe(202);
      const session = await waitForLatestSession(server.url, server.nonce);
      const rootIndex = await readFile(path.join(cwd, "index.js"), "utf8");

      expect(session.state.changedFiles).toContain("index.js");
      expect(rootIndex).toContain("root should stay unchanged");
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("records browser run cancellation as an aborted session event", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-cancel-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/runs?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: "fix failing test", runMode: "fixture", accessMode: "partial" })
      });
      const startPayload = await response.json() as { sessionId: string };

      expect(response.status).toBe(202);
      expect(startPayload.sessionId).toMatch(/^session_/);

      const cancelResponse = await fetch(`${server.url}/api/runs/${startPayload.sessionId}/cancel?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      const cancelPayload = await cancelResponse.json() as { status: string; message: string; viewModel: { status: string; rawEvents: Array<{ type: string; result?: string; reason?: string }> } };
      const session = await fetch(`${server.url}/api/sessions/${startPayload.sessionId}?nonce=${server.nonce}`).then((item) => item.json()) as { state: { finalSummary?: { result: string }; events: Array<{ type: string; result?: string; reason?: string }> } };

      expect(cancelResponse.status).toBe(200);
      expect(cancelPayload.status).toBe("canceled");
      expect(cancelPayload.message).toContain("canceled");
      expect(cancelPayload.viewModel.status).toBe("failed");
      expect(cancelPayload.viewModel.rawEvents).toContainEqual(expect.objectContaining({
        type: "workflow_stop_reason",
        result: "aborted",
        reason: "User canceled the run from the cockpit."
      }));
      expect(session.state.finalSummary?.result).toBe("aborted");
      expect(session.state.events).toContainEqual(expect.objectContaining({
        type: "workflow_stop_reason",
        result: "aborted"
      }));
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("continues browser approvals in the prepared GUI fixture workspace", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-fixture-approval-"));
    await mkdir(path.join(cwd, "tests", "fixtures"), { recursive: true });
    await cp(path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic"), path.join(cwd, "tests", "fixtures", "sample-repo-basic"), { recursive: true });
    await writeFile(path.join(cwd, "package.json"), "{\"scripts\":{\"test\":\"node test.js\"}}\n", "utf8");
    await writeFile(path.join(cwd, "index.js"), "module.exports = { add: () => 'root should stay unchanged' };\n", "utf8");
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/runs?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: "fix failing test", runMode: "fixture", accessMode: "partial" })
      });
      expect(response.status).toBe(202);
      const session = await waitForLatestSession(server.url, server.nonce);
      const vm = await fetch(`${server.url}/api/sessions/${session.state.sessionId}/view-model?nonce=${server.nonce}`).then((item) => item.json()) as { currentApproval?: { id: string; kind: string } };

      expect(session.state.runContext?.fixtureWorkspace).toBeTruthy();
      expect(session.state.runContext?.executionCwd).toBe(session.state.runContext?.fixtureWorkspace);
      expect(vm.currentApproval?.kind).toBe("patch");

      const patchResponse = await fetch(`${server.url}/api/approvals?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: session.state.sessionId, action: "approve_patch", approvalId: vm.currentApproval?.id })
      });
      const patchPayload = await patchResponse.json() as { status: string; viewModel: { currentApproval?: { id: string; kind: string }; main: { filesChanged: string[] } } };
      const rootIndexAfterPatch = await readFile(path.join(cwd, "index.js"), "utf8");

      expect(patchResponse.status).toBe(200);
      expect(patchPayload.status).toBe("applied");
      expect(patchPayload.viewModel.currentApproval?.kind).toBe("shell");
      expect(patchPayload.viewModel.main.filesChanged).toContain("index.js");
      expect(rootIndexAfterPatch).toContain("root should stay unchanged");

      const shellResponse = await fetch(`${server.url}/api/approvals?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: session.state.sessionId, action: "approve_shell", approvalId: patchPayload.viewModel.currentApproval?.id })
      });
      const shellPayload = await shellResponse.json() as { status: string; viewModel: { status: string; objectiveTrace?: { outcomeStatus?: string }; rawEvents: Array<{ type: string; success?: boolean }> } };
      const rootIndexAfterShell = await readFile(path.join(cwd, "index.js"), "utf8");

      expect(shellResponse.status).toBe(200);
      expect(shellPayload.status).toBe("executed");
      expect(shellPayload.viewModel.status).toBe("done");
      expect(shellPayload.viewModel.objectiveTrace?.outcomeStatus).toBe("success");
      expect(shellPayload.viewModel.rawEvents.some((event) => event.type === "shell_run" && event.success)).toBe(true);
      expect(rootIndexAfterShell).toContain("root should stay unchanged");
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("passes GUI target and offline mode through the native backend", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-run-target-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/runs?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: "review architecture and suggest improvements, do not edit", runMode: "offline", accessMode: "restricted", to: "reviewer" })
      });
      expect(response.status).toBe(202);
      const session = await waitForLatestSession(server.url, server.nonce);
      const target = session.state.events.find((event) => event.type === "conversation_target") as { target?: string } | undefined;
      const modelCalls = session.state.events.filter((event) => event.type === "model_call");

      expect(target?.target).toBe("reviewer");
      expect(modelCalls.every((event) => event.provider === "mock")).toBe(true);
      expect(session.state.finalSummary?.result).toBe("completed");
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("honors CLI project preferences for GUI runs", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-run-prefs-"));
    await mkdir(path.join(cwd, ".tomorrowedge"), { recursive: true });
    await writeFile(path.join(cwd, ".tomorrowedge", "preferences.json"), JSON.stringify({ accessMode: "full" }), "utf8");
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/runs?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: "list files and summarize structure", runMode: "offline" })
      });
      expect(response.status).toBe(202);
      const session = await waitForLatestSession(server.url, server.nonce);

      expect(session.state.access.mode).toBe("full");
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("exposes first-run setup status and configures a provider through env indirection", async () => {
    await withEnvOverrides({ OPENROUTER_API_KEY: undefined, TEST_OPENROUTER_KEY: undefined }, async () => {
      const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-setup-"));
      const server = await startLocalCockpitServer(cwd, { port: 0 });
      try {
        const before = await fetch(`${server.url}/api/setup/status?nonce=${server.nonce}`).then((response) => response.json()) as { needsSetup: boolean; recommendedProvider: string; selectedProvider?: string; selectedModel?: string; providers: Array<{ id: string; keyConfigured: boolean }> };

        expect(before.needsSetup).toBe(true);
        expect(before.recommendedProvider).toBe("openrouter");
        expect(before.selectedProvider).toBeUndefined();
        expect(before.selectedModel).toBeUndefined();
        expect(before.providers.some((provider) => provider.id === "openrouter" && provider.keyConfigured === false)).toBe(true);

        const response = await fetch(`${server.url}/api/setup/configure?nonce=${server.nonce}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            provider: "openrouter",
            model: "MoonshotAI: Kimi K2.6 (free)",
            apiKeyEnv: "TEST_OPENROUTER_KEY",
            apiKey: "test-openrouter-key-value",
            bindRoles: true
          })
        });
        const after = await response.json() as { needsSetup: boolean; selectedProvider?: string; selectedModel?: string; providers: Array<{ id: string; keyConfigured: boolean }> };
        const configText = await readFile(path.join(cwd, ".tomorrowedge", "config.yaml"), "utf8");
        const secretsFile = await readFile(path.join(cwd, ".tomorrowedge", "secrets.enc"), "utf8");

        expect(response.status).toBe(200);
        expect(after.needsSetup).toBe(false);
        expect(after.selectedProvider).toBe("openrouter");
        expect(after.selectedModel).toBe("moonshotai/kimi-k2.6:free");
        expect(after.providers.find((provider) => provider.id === "openrouter")?.keyConfigured).toBe(true);
        expect(configText).toContain("api_key_env: TEST_OPENROUTER_KEY");
        expect(configText).not.toContain("test-openrouter-key-value");
        expect(secretsFile).toContain("encrypted_file");
        expect(secretsFile).not.toContain("test-openrouter-key-value");
      } finally {
        await server.close();
        await rm(cwd, { recursive: true, force: true });
      }
    });
  });

  it("manages provider keys through encrypted storage without writing secrets to config", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-keys-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/setup/keys/openrouter?nonce=${server.nonce}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "moonshotai/kimi-k2:free",
          apiKeyEnv: "TEST_KEY_PANEL_OPENROUTER",
          apiKey: "test-panel-openrouter-key"
        })
      });
      const afterSave = await response.json() as { selectedProvider?: string; providers: Array<{ id: string; keyConfigured: boolean; keySource: string; maskedKey?: string }> };
      const configText = await readFile(path.join(cwd, ".tomorrowedge", "config.yaml"), "utf8");
      const secretsFile = await readFile(path.join(cwd, ".tomorrowedge", "secrets.enc"), "utf8");

      expect(response.status).toBe(200);
      expect(afterSave.selectedProvider).toBe("openrouter");
      expect(afterSave.providers.find((provider) => provider.id === "openrouter")).toMatchObject({
        keyConfigured: true,
        keySource: "encrypted_file",
        maskedKey: "test****-key"
      });
      expect(configText).toContain("api_key_env: TEST_KEY_PANEL_OPENROUTER");
      expect(configText).toContain("model: moonshotai/kimi-k2.6:free");
      expect(configText).not.toContain("moonshotai/kimi-k2:free");
      expect(configText).not.toContain("test-panel-openrouter-key");
      expect(secretsFile).toContain("encrypted_file");
      expect(secretsFile).not.toContain("test-panel-openrouter-key");

      const missingConfirmation = await fetch(`${server.url}/api/setup/keys/openrouter?nonce=${server.nonce}`, { method: "DELETE" });
      const confirmationError = await missingConfirmation.json() as { error: string };
      const deleteResponse = await fetch(`${server.url}/api/setup/keys/openrouter?nonce=${server.nonce}&confirmed=true`, { method: "DELETE" });
      const afterDelete = await deleteResponse.json() as { providers: Array<{ id: string; enabled: boolean; keyConfigured: boolean }> };
      const secretsFileAfterDelete = await readOptionalFile(path.join(cwd, ".tomorrowedge", "secrets.enc"));

      expect(missingConfirmation.status).toBe(400);
      expect(confirmationError.error).toBe("delete_key_confirmation_required");
      expect(deleteResponse.status).toBe(200);
      expect(afterDelete.providers.find((provider) => provider.id === "openrouter")).toMatchObject({
        enabled: false,
        keyConfigured: false
      });
      expect(secretsFileAfterDelete).toBe("");
    } finally {
      delete process.env.TEST_KEY_PANEL_OPENROUTER;
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("keeps DeepSeek testable when the GUI saves only key, env, and model", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-deepseek-key-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/setup/keys/deepseek?nonce=${server.nonce}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "deepseek-v4-pro",
          apiKeyEnv: "TEST_KEY_PANEL_DEEPSEEK",
          apiKey: "test-panel-deepseek-key"
        })
      });
      const afterSave = await response.json() as { providers: Array<{ id: string; baseUrl: string; keyConfigured: boolean }> };
      const config = loadConfig(cwd);

      expect(response.status).toBe(200);
      expect(afterSave.providers.find((provider) => provider.id === "deepseek")).toMatchObject({
        baseUrl: "https://api.deepseek.com",
        keyConfigured: true
      });
      expect(config.providers.deepseek.base_url).toBe("https://api.deepseek.com");
    } finally {
      delete process.env.TEST_KEY_PANEL_DEEPSEEK;
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("saves provider model metadata without re-entering an already configured key", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-model-only-save-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const first = await fetch(`${server.url}/api/setup/keys/openrouter?nonce=${server.nonce}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "moonshotai/kimi-k2.6:free",
          apiKeyEnv: "TEST_MODEL_ONLY_OPENROUTER",
          apiKey: "test-model-only-key"
        })
      });
      const second = await fetch(`${server.url}/api/setup/keys/openrouter?nonce=${server.nonce}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "qwen/qwen3-coder:free",
          baseUrl: "https://openrouter.ai/api/v1/",
          apiKeyEnv: "TEST_MODEL_ONLY_OPENROUTER"
        })
      });
      const payload = await second.json() as { providers: Array<{ id: string; model: string; keyConfigured: boolean }> };
      const config = loadConfig(cwd);
      const secretsFile = await readFile(path.join(cwd, ".tomorrowedge", "secrets.enc"), "utf8");

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(payload.providers.find((provider) => provider.id === "openrouter")).toMatchObject({
        model: "qwen/qwen3-coder:free",
        keyConfigured: true
      });
      expect(config.providers.openrouter.model).toBe("qwen/qwen3-coder:free");
      expect(secretsFile).not.toContain("test-model-only-key");
    } finally {
      delete process.env.TEST_MODEL_ONLY_OPENROUTER;
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("persists per-request timeout and retry controls separately from workflow iterations", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-provider-runtime-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/setup/keys/openrouter?nonce=${server.nonce}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "moonshotai/kimi-k2.6:free",
          apiKeyEnv: "TEST_RUNTIME_OPENROUTER",
          apiKey: "test-runtime-key",
          requestTimeoutMs: 120000,
          maxRetries: 2
        })
      });
      const payload = await response.json() as { providers: Array<{ id: string; requestTimeoutMs: number; maxRetries: number }> };
      const config = loadConfig(cwd);

      expect(response.status).toBe(200);
      expect(payload.providers.find((provider) => provider.id === "openrouter")).toMatchObject({
        requestTimeoutMs: 120000,
        maxRetries: 2
      });
      expect(config.providers.openrouter.requestTimeoutMs).toBe(120000);
      expect(config.providers.openrouter.maxRetries).toBe(2);
      expect(config.autonomy.max_iterations).toBe(defaultConfig.autonomy.max_iterations);
    } finally {
      delete process.env.TEST_RUNTIME_OPENROUTER;
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects model-only provider saves when no key is configured", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-model-only-missing-key-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/setup/keys/openrouter?nonce=${server.nonce}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "qwen/qwen3-coder:free",
          apiKeyEnv: "TEST_MODEL_ONLY_MISSING_OPENROUTER"
        })
      });
      const payload = await response.json() as { error: string; message: string };

      expect(response.status).toBe(400);
      expect(payload.error).toBe("setup_error");
      expect(payload.message).toContain("API key is required");
    } finally {
      delete process.env.TEST_MODEL_ONLY_MISSING_OPENROUTER;
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("lists provider model recommendations for the GUI key manager", async () => {
    await withEnvOverrides({ DEEPSEEK_API_KEY: undefined }, async () => {
      const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-model-list-"));
      const server = await startLocalCockpitServer(cwd, { port: 0 });
      try {
        const response = await fetch(`${server.url}/api/setup/models?provider=deepseek&nonce=${server.nonce}`);
        const models = await response.json() as Array<{ id: string; source: string; isFree?: boolean }>;

        expect(response.status).toBe(200);
        expect(models).toContainEqual(expect.objectContaining({ id: "deepseek-chat", source: "static" }));
      } finally {
        await server.close();
        await rm(cwd, { recursive: true, force: true });
      }
    });
  });

  it("discovers configured non-OpenRouter provider models before static fallback", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-dynamic-models-"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      expect(String(input)).toBe("https://api.deepseek.example/v1/models");
      return new Response(JSON.stringify({
        data: [
          { id: "deepseek-live-a", name: "DeepSeek Live A" },
          { id: "deepseek-live-b", name: "DeepSeek Live B" }
        ]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try {
      await writeConfig(cwd, {
        ...defaultConfig,
        providers: {
          ...defaultConfig.providers,
          deepseek: {
            ...defaultConfig.providers.deepseek,
            enabled: true,
            base_url: "https://api.deepseek.example/v1",
            auth_header: "none"
          }
        }
      });
      const models = await listCockpitProviderModels(cwd, "deepseek", 5);

      expect(models).toContainEqual(expect.objectContaining({ id: "deepseek-live-a", source: "catalog" }));
      expect(models).not.toContainEqual(expect.objectContaining({ id: "deepseek-chat", source: "static" }));
    } finally {
      globalThis.fetch = originalFetch;
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("normalizes OpenRouter catalog recommendations for the GUI key manager", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-openrouter-models-"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      data: [{
        id: "qwen/qwen3-coder:free",
        name: "Qwen3 Coder Free",
        context_length: 262144,
        pricing: { prompt: "0", completion: "0" },
        architecture: { input_modalities: ["text"], output_modalities: ["text"] }
      }]
    }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const models = await listCockpitProviderModels(cwd, "openrouter", 5);

      expect(models).toContainEqual(expect.objectContaining({
        id: "qwen/qwen3-coder:free",
        source: "catalog",
        isFree: true
      }));
    } finally {
      globalThis.fetch = originalFetch;
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("keeps OpenAI-compatible fallback models free of OpenRouter-specific ids", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-compatible-models-"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("gateway unavailable", { status: 503 })) as typeof fetch;
    try {
      const models = await listCockpitProviderModels(cwd, "openai_compatible", 5);

      expect(models).toContainEqual(expect.objectContaining({ id: "gpt-4o-mini", source: "static" }));
      expect(models).not.toContainEqual(expect.objectContaining({ id: "qwen/qwen3-coder:free" }));
    } finally {
      globalThis.fetch = originalFetch;
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("coalesces concurrent provider model discovery requests", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-model-cache-"));
    const originalFetch = globalThis.fetch;
    clearCockpitProviderModelCache();
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response(JSON.stringify({
        data: [{ id: "deepseek-live-cached", name: "DeepSeek Live Cached" }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try {
      await writeConfig(cwd, {
        ...defaultConfig,
        providers: {
          ...defaultConfig.providers,
          deepseek: {
            ...defaultConfig.providers.deepseek,
            enabled: true,
            base_url: "https://api.deepseek-cache.example/v1",
            auth_header: "none"
          }
        }
      });
      const [first, second] = await Promise.all([
        listCockpitProviderModels(cwd, "deepseek", 5),
        listCockpitProviderModels(cwd, "deepseek", 5)
      ]);

      expect(calls).toBe(1);
      expect(first).toContainEqual(expect.objectContaining({ id: "deepseek-live-cached", source: "catalog" }));
      expect(second).toContainEqual(expect.objectContaining({ id: "deepseek-live-cached", cached: true }));
    } finally {
      clearCockpitProviderModelCache();
      globalThis.fetch = originalFetch;
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("reuses stale provider model catalogs when refresh fails", async () => {
    await withEnvOverrides({ TOMORROWEDGE_COCKPIT_MODEL_CACHE_TTL_MS: "0" }, async () => {
      const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-model-stale-"));
      const originalFetch = globalThis.fetch;
      clearCockpitProviderModelCache();
      let calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(JSON.stringify({
            data: [{ id: "deepseek-live-stale", name: "DeepSeek Live Stale" }]
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response("provider outage", { status: 503 });
      }) as typeof fetch;
      try {
        await writeConfig(cwd, {
          ...defaultConfig,
          providers: {
            ...defaultConfig.providers,
            deepseek: {
              ...defaultConfig.providers.deepseek,
              enabled: true,
              base_url: "https://api.deepseek-stale.example/v1",
              auth_header: "none"
            }
          }
        });
        await listCockpitProviderModels(cwd, "deepseek", 5);
        const stale = await listCockpitProviderModels(cwd, "deepseek", 5);

        expect(calls).toBe(2);
        expect(stale).toContainEqual(expect.objectContaining({
          id: "deepseek-live-stale",
          cached: true,
          stale: true
        }));
      } finally {
        clearCockpitProviderModelCache();
        globalThis.fetch = originalFetch;
        await rm(cwd, { recursive: true, force: true });
      }
    });
  });

  it("rejects provider-model mismatches before saving provider keys", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-provider-mismatch-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/setup/keys/openai_compatible?nonce=${server.nonce}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "qwen/qwen3-coder:free",
          apiKeyEnv: "TEST_KEY_PANEL_OPENAI_COMPATIBLE",
          apiKey: "test-compatible-key"
        })
      });
      const payload = await response.json() as { error: string; message: string };
      const config = loadConfig(cwd);

      expect(response.status).toBe(400);
      expect(payload.error).toBe("setup_error");
      expect(payload.message).toContain("switch provider to OpenRouter");
      expect(config.providers.openai_compatible.model).toBe(defaultConfig.providers.openai_compatible.model);
    } finally {
      delete process.env.TEST_KEY_PANEL_OPENAI_COMPATIBLE;
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects provider-model mismatches during first-run setup and role assignment", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-role-mismatch-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const setupResponse = await fetch(`${server.url}/api/setup/configure?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "deepseek",
          model: "openai/gpt-5.2",
          apiKeyEnv: "TEST_DEEPSEEK_MISMATCH",
          apiKey: "test-deepseek-key"
        })
      });
      const setupPayload = await setupResponse.json() as { error: string; message: string };

      expect(setupResponse.status).toBe(400);
      expect(setupPayload.message).toContain("does not match provider deepseek");

      const roleResponse = await fetch(`${server.url}/api/setup/roles?nonce=${server.nonce}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assignments: [
            { role: "coder_a", provider: "deepseek", model: "openai/gpt-5.2" }
          ]
        })
      });
      const rolePayload = await roleResponse.json() as { error: string; message: string };

      expect(roleResponse.status).toBe(400);
      expect(rolePayload.error).toBe("setup_error");
      expect(rolePayload.message).toContain("does not match provider deepseek");
    } finally {
      delete process.env.TEST_DEEPSEEK_MISMATCH;
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("saves custom OpenAI-compatible base URLs from the GUI key manager", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-compatible-key-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/setup/keys/openai_compatible?nonce=${server.nonce}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "custom-compatible-model",
          baseUrl: "https://compatible.example.com/v1/",
          apiKeyEnv: "TEST_KEY_PANEL_COMPATIBLE",
          apiKey: "test-panel-compatible-key"
        })
      });
      const afterSave = await response.json() as { providers: Array<{ id: string; baseUrl: string; keyConfigured: boolean }> };
      const config = loadConfig(cwd);

      expect(response.status).toBe(200);
      expect(afterSave.providers.find((provider) => provider.id === "openai_compatible")).toMatchObject({
        baseUrl: "https://compatible.example.com/v1",
        keyConfigured: true
      });
      expect(config.providers.openai_compatible.base_url).toBe("https://compatible.example.com/v1");
    } finally {
      delete process.env.TEST_KEY_PANEL_COMPATIBLE;
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("creates custom relay endpoint providers from the GUI key manager", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-custom-gateway-key-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/setup/keys/team-relay?nonce=${server.nonce}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "relay-model",
          baseUrl: "https://relay.example/v1/",
          apiKeyEnv: "TEAM_RELAY_KEY",
          apiKey: "test-relay-key",
          apiFormat: "legacy_chat",
          authHeader: "api-key",
          extraHeaders: {
            "X-Relay-Name": "team-gateway"
          },
          requestTimeoutMs: 45000,
          maxRetries: 2
        })
      });
      const afterSave = await response.json() as { selectedProvider?: string; providers: Array<{ id: string; baseUrl: string; keyConfigured: boolean; keySource: string; apiFormat: string; authHeader: string; extraHeaders: Record<string, string>; requestTimeoutMs: number; maxRetries: number }> };
      const config = loadConfig(cwd);
      const configText = await readFile(path.join(cwd, ".tomorrowedge", "config.yaml"), "utf8");
      const secretsFile = await readFile(path.join(cwd, ".tomorrowedge", "secrets.enc"), "utf8");

      expect(response.status).toBe(200);
      expect(afterSave.selectedProvider).toBe("team_relay");
      expect(afterSave.providers.find((provider) => provider.id === "team_relay")).toMatchObject({
        baseUrl: "https://relay.example/v1",
        keyConfigured: true,
        keySource: "encrypted_file",
        apiFormat: "legacy_chat",
        authHeader: "api-key",
        extraHeaders: { "X-Relay-Name": "team-gateway" },
        requestTimeoutMs: 45000,
        maxRetries: 2
      });
      expect(config.providers.team_relay).toMatchObject({
        enabled: true,
        base_url: "https://relay.example/v1",
        model: "relay-model",
        api_key_env: "TEAM_RELAY_KEY",
        api_format: "legacy_chat",
        auth_header: "api-key",
        extra_headers: { "X-Relay-Name": "team-gateway" },
        requestTimeoutMs: 45000,
        maxRetries: 2
      });
      expect(configText).not.toContain("test-relay-key");
      expect(secretsFile).not.toContain("test-relay-key");
    } finally {
      delete process.env.TEAM_RELAY_KEY;
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("saves no-auth custom relay endpoint providers from the GUI key manager", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-no-auth-gateway-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/setup/keys/local-relay?nonce=${server.nonce}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "local-relay-model",
          baseUrl: "http://localhost:9000/v1",
          apiFormat: "openai_chat",
          authHeader: "none",
          extraHeaders: {}
        })
      });
      const afterSave = await response.json() as { providers: Array<{ id: string; keyConfigured: boolean; keySource: string; authRequired: boolean; apiKeyEnv?: string }> };
      const config = loadConfig(cwd);

      expect(response.status).toBe(200);
      expect(afterSave.providers.find((provider) => provider.id === "local_relay")).toMatchObject({
        keyConfigured: true,
        keySource: "not_required",
        authRequired: false
      });
      expect(config.providers.local_relay).toMatchObject({
        enabled: true,
        base_url: "http://localhost:9000/v1",
        model: "local-relay-model",
        api_format: "openai_chat",
        auth_header: "none",
        extra_headers: {}
      });
      expect(config.providers.local_relay.api_key_env).toBeUndefined();
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("treats explicitly routed no-auth local providers as GUI-ready", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-local-ready-"));
    const config = loadConfig(cwd);
    const agents = Object.fromEntries(Object.keys(config.agents).map((role) => [role, {
      provider: "ollama",
      model: "local-auto",
      reason: "Test local provider route"
    }]));
    await writeConfig(cwd, {
      ...config,
      providers: {
        ...config.providers,
        ollama: {
          enabled: true,
          base_url: "http://localhost:11434",
          model: "local-auto",
          api_format: "openai_chat",
          auth_header: "none",
          extra_headers: {}
        }
      },
      agents
    });
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const status = await fetch(`${server.url}/api/setup/status?nonce=${server.nonce}`).then((response) => response.json()) as {
        needsSetup: boolean;
        selectedProvider?: string;
        selectedModel?: string;
        providers: Array<{ id: string; keyConfigured: boolean; keySource: string; authRequired: boolean }>;
      };

      expect(status.needsSetup).toBe(false);
      expect(status.selectedProvider).toBe("ollama");
      expect(status.selectedModel).toBe("local-auto");
      expect(status.providers.find((provider) => provider.id === "ollama")).toMatchObject({
        keyConfigured: true,
        keySource: "not_required",
        authRequired: false
      });
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("treats explicitly routed external agents as GUI-ready", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-external-ready-"));
    const config = loadConfig(cwd);
    const agents = Object.fromEntries(Object.keys(config.agents).map((role) => [role, {
      provider: "external:codex",
      model: "auto",
      reason: "Test external agent route"
    }]));
    await writeConfig(cwd, {
      ...config,
      external_agents: {
        ...config.external_agents,
        codex: {
          ...config.external_agents.codex,
          enabled: true,
          command: process.execPath,
          args: ["mock-mcp-server"],
          autoStart: true
        }
      },
      agents
    });
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const status = await fetch(`${server.url}/api/setup/status?nonce=${server.nonce}`).then((response) => response.json()) as {
        needsSetup: boolean;
        selectedProvider?: string;
        selectedModel?: string;
        externalAgents: Array<{ id: string; provider: string }>;
      };

      expect(status.needsSetup).toBe(false);
      expect(status.selectedProvider).toBe("external:codex");
      expect(status.selectedModel).toBe("auto");
      expect(status.externalAgents).toContainEqual(expect.objectContaining({
        id: "codex",
        provider: "external:codex"
      }));
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("saves GUI role assignments into provider/model agent routing", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-roles-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      await fetch(`${server.url}/api/setup/keys/openrouter?nonce=${server.nonce}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "moonshotai/kimi-k2.6:free",
          apiKeyEnv: "TEST_ROLE_PANEL_OPENROUTER",
          apiKey: "test-role-panel-key"
        })
      });
      const response = await fetch(`${server.url}/api/setup/roles?nonce=${server.nonce}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assignments: [
            { role: "planner", provider: "openrouter", model: "openai/gpt-5.2" },
            { role: "coder_a", provider: "deepseek", model: "deepseek-chat" }
          ]
        })
      });
      const payload = await response.json() as { roleAssignments: Array<{ role: string; provider: string; model: string }> };
      const config = loadConfig(cwd);

      expect(response.status).toBe(200);
      expect(payload.roleAssignments.find((assignment) => assignment.role === "planner")).toMatchObject({ provider: "openrouter", model: "openai/gpt-5.2" });
      expect(config.agents.planner).toMatchObject({ provider: "openrouter", model: "openai/gpt-5.2" });
      expect(config.agents.coder_a).toMatchObject({ provider: "deepseek", model: "deepseek-chat" });
    } finally {
      delete process.env.TEST_ROLE_PANEL_OPENROUTER;
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("exposes configured external agents for GUI role assignment", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-external-roles-"));
    const config = loadConfig(cwd);
    await writeConfig(cwd, {
      ...config,
      external_agents: {
        ...config.external_agents,
        codex: {
          ...config.external_agents.codex,
          enabled: true,
          command: process.execPath,
          args: ["mock-mcp-server"],
          autoStart: true
        }
      }
    });
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const status = await fetch(`${server.url}/api/setup/status?nonce=${server.nonce}`).then((response) => response.json()) as { externalAgents: Array<{ id: string; provider: string; name: string }> };

      expect(status.externalAgents).toContainEqual(expect.objectContaining({
        id: "codex",
        provider: "external:codex",
        name: "Codex"
      }));

      const response = await fetch(`${server.url}/api/setup/roles?nonce=${server.nonce}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assignments: [
            { role: "reviewer", provider: "external:codex", model: "auto" }
          ]
        })
      });
      const payload = await response.json() as { roleAssignments: Array<{ role: string; provider: string; model: string }> };
      const saved = loadConfig(cwd);

      expect(response.status).toBe(200);
      expect(payload.roleAssignments.find((assignment) => assignment.role === "reviewer")).toMatchObject({ provider: "external:codex", model: "auto" });
      expect(saved.agents.reviewer).toMatchObject({ provider: "external:codex", model: "auto" });
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("requires a model during first-run provider setup", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-setup-model-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/setup/configure?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "openrouter", model: "" })
      });
      const payload = await response.json() as { error: string };

      expect(response.status).toBe(400);
      expect(payload.error).toBe("model_required");
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

  it("rejects empty run goals instead of starting a default patch workflow", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-empty-run-"));
    const server = await startLocalCockpitServer(cwd, { port: 0 });
    try {
      const response = await fetch(`${server.url}/api/runs?nonce=${server.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: "   " })
      });
      const payload = await response.json() as { error: string };
      const sessions = await fetch(`${server.url}/api/sessions?nonce=${server.nonce}`).then((item) => item.json()) as unknown[];

      expect(response.status).toBe(400);
      expect(payload.error).toBe("goal_required");
      expect(sessions).toEqual([]);
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

async function waitForLatestSession(url: string, nonce: string): Promise<{ state: { sessionId: string; runContext?: { executionCwd?: string; fixtureWorkspace?: string }; access: { mode: string }; events: Array<{ type: string }>; changedFiles: string[]; finalSummary?: { result: string } } }> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`${url}/api/sessions/latest?nonce=${nonce}`);
    if (response.status === 200) {
      const session = await response.json() as { state: { sessionId: string; runContext?: { executionCwd?: string; fixtureWorkspace?: string }; access: { mode: string }; events: Array<{ type: string }>; changedFiles: string[]; finalSummary?: { result: string } } };
      if (session.state.finalSummary) return session;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for latest cockpit session.");
}

async function waitForSessionEventCount(url: string, nonce: string, sessionId: string, minEvents: number): Promise<{ state: { sessionId: string; events: Array<{ type: string; policySummary?: string }>; finalSummary?: { evidence: string[] } } }> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`${url}/api/sessions/${sessionId}?nonce=${nonce}`);
    if (response.status === 200) {
      const session = await response.json() as { state: { sessionId: string; events: Array<{ type: string; policySummary?: string }>; finalSummary?: { evidence: string[] } } };
      if (session.state.events.length >= minEvents && session.state.finalSummary) return session;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for cockpit session ${sessionId}.`);
}

async function readOptionalFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}
