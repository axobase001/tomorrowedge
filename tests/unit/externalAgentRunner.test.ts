import path from "node:path";
import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { createEventLedger } from "../../src/core/events/eventLedger.js";
import { diagnoseExternalAgentProfile, resolveExternalAgentWorkingDirectory } from "../../src/core/externalAgents/externalAgentDiagnostics.js";
import { buildExternalAgentEnv, isCodexCommand, probeExternalAgent } from "../../src/core/externalAgents/externalAgentProcess.js";
import { externalAgentProcessPoolSize, invokeExternalRole, releaseExternalAgentProcessPool } from "../../src/core/externalAgents/externalRoleInvoker.js";
import { runCommandExternalAgent } from "../../src/core/externalAgents/runners/commandExternalAgentRunner.js";
import { runMockExternalAgent } from "../../src/core/externalAgents/runners/mockExternalAgentRunner.js";
import type { ExternalAgentProfile } from "../../src/core/externalAgents/externalAgentTypes.js";

describe("external agent runners", () => {
  it("records mock runner calls and results in the event ledger", async () => {
    const ledger = createEventLedger("full", "session_external_mock");
    const profile = profileFor("mock_planner");

    const result = await runMockExternalAgent({
      cwd: process.cwd(),
      profile,
      role: "planner",
      task: "split a local toy LM implementation",
      ledger
    });

    expect(result.ok).toBe(true);
    expect(ledger.events.map((event) => event.type)).toEqual(expect.arrayContaining(["external_agent_call", "external_agent_result"]));
    expect(ledger.artifacts.some((artifact) => artifact.ref.includes("external_agent_request"))).toBe(true);
  });

  it("spawns a configured command, passes context, and records stdout/stderr refs", async () => {
    const ledger = createEventLedger("full", "session_external_command");
    const profile = {
      ...profileFor("codex_command"),
      command: process.execPath,
      args: [path.join(process.cwd(), "tests", "fixtures", "mock-command-agent.mjs")]
    };

    const result = await runCommandExternalAgent({
      cwd: process.cwd(),
      profile,
      role: "reviewer",
      task: "review generated tiny LM service",
      context: { files: ["examples/tiny-local-lm/server.js"] },
      ledger,
      timeoutMs: 10_000
    });

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("sameTaskFromFile");
    expect(result.summary).toContain("mock command handled reviewer");
    expect(ledger.events.map((event) => event.type)).toEqual(expect.arrayContaining(["external_agent_call", "external_agent_result"]));
    expect(ledger.artifacts.some((artifact) => artifact.content.includes("sameTaskFromFile"))).toBe(true);
  });

  it("builds localhost proxy env for MCP process profiles", () => {
    const env = buildExternalAgentEnv(
      {
        ...profileFor("codex_mcp"),
        proxyPort: 7890,
        env: { NODE_ENV: "test" }
      },
      { PATH: "/usr/bin" }
    );

    expect(env.HTTP_PROXY).toBe("http://127.0.0.1:7890");
    expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:7890");
    expect(env.ALL_PROXY).toBe("http://127.0.0.1:7890");
    expect(env.http_proxy).toBe("http://127.0.0.1:7890");
    expect(env.NODE_ENV).toBe("test");
    expect(env.PATH).toBe("/usr/bin");
  });

  it("detects Codex MCP commands across common Windows and POSIX launchers", () => {
    expect(isCodexCommand("codex")).toBe(true);
    expect(isCodexCommand("C:\\Users\\PC\\AppData\\Roaming\\npm\\codex.cmd")).toBe(true);
    expect(isCodexCommand("/usr/local/bin/codex")).toBe(true);
    expect(isCodexCommand("claude")).toBe(false);
  });

  it("diagnoses invokable external agent process configuration", () => {
    const diagnostic = diagnoseExternalAgentProfile(
      {
        ...profileFor("codex_mcp"),
        command: process.execPath,
        args: [path.join(process.cwd(), "tests", "fixtures", "mock-external-mcp-server.mjs")],
        cwd: "tests/fixtures",
        autoStart: true
      },
      process.cwd()
    );

    expect(diagnostic.status).toBe("ready");
    expect(diagnostic.mode).toBe("stdio_mcp");
    expect(diagnostic.resolvedCommand).toBe(process.execPath);
    expect(diagnostic.cwd).toBe(path.join(process.cwd(), "tests", "fixtures"));
    expect(resolveExternalAgentWorkingDirectory({ ...profileFor("relative"), cwd: "tests" }, process.cwd())).toBe(path.join(process.cwd(), "tests"));
  });

  it("reuses auto-started MCP process clients across role calls", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "tedge-mcp-pool-"));
    const spawnLog = path.join(temp, "spawn.log");
    const ledger = createEventLedger("full", "session_external_pool");
    const profile = {
      ...profileFor("codex_mcp_pool"),
      command: process.execPath,
      args: [path.join(process.cwd(), "tests", "fixtures", "mock-external-mcp-server.mjs")],
      autoStart: true,
      env: { TEDGE_MOCK_MCP_SPAWN_LOG: spawnLog }
    };

    try {
      await invokeExternalRole({ cwd: process.cwd(), profile, role: "planner", prompt: "plan once", ledger });
      await invokeExternalRole({ cwd: process.cwd(), profile, role: "reviewer", prompt: "review once", ledger });

      expect(externalAgentProcessPoolSize()).toBe(1);
      await releaseExternalAgentProcessPool();
      expect(externalAgentProcessPoolSize()).toBe(0);
      expect((await readFile(spawnLog, "utf8")).trim().split(/\r?\n/)).toHaveLength(1);
    } finally {
      await releaseExternalAgentProcessPool();
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("retries malformed strict Codex patch output once and accepts a valid second response", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "tedge-external-retry-"));
    const counter = path.join(temp, "count.txt");
    const ledger = createEventLedger("full", "session_external_retry");
    const script = [
      "const fs = require('fs');",
      "const p = process.env.TEDGE_RETRY_COUNTER;",
      "let n = 0;",
      "try { n = Number(fs.readFileSync(p, 'utf8')) || 0; } catch {}",
      "n += 1;",
      "fs.writeFileSync(p, String(n));",
      "if (n === 1) { console.log('not-json'); process.exit(0); }",
      "console.log(JSON.stringify({ summary: 'valid second patch', candidate: { candidateId: 'retry_candidate', agentId: 'coder_a', approach: 'minimal_patch', summary: 'valid second patch', filesChanged: ['index.js'], unifiedDiff: '--- a/index.js\\n+++ b/index.js\\n@@ -1 +1 @@\\n-a\\n+b\\n', testPlan: ['npm test'], knownTradeoffs: [], estimatedRisk: 'low' } }));"
    ].join("\n");
    const profile: ExternalAgentProfile = {
      ...profileFor("codex_retry"),
      adapter: "codex",
      command: process.execPath,
      args: ["-e", script],
      env: { TEDGE_RETRY_COUNTER: counter },
      autoStart: false,
      allowedRoles: ["coder_a"],
      capabilities: ["coding"],
      strictJson: true,
      normalizationStrictness: "strict"
    };

    try {
      await writeFile(counter, "0", "utf8");
      const result = await invokeExternalRole({ cwd: process.cwd(), profile, role: "coder_a", prompt: "patch", ledger });

      expect(result.attempts).toBe(2);
      expect(result.payload).toMatchObject({ candidate: { candidateId: "retry_candidate" } });
      expect(result.evidencePackets.some((packet) => packet.phase === "patch")).toBe(true);
      expect(ledger.events).toContainEqual(expect.objectContaining({ type: "external_agent_retry", role: "coder_a", attempt: 2 }));
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("aborts strict external output after the retry is still invalid", async () => {
    const ledger = createEventLedger("full", "session_external_retry_fail");
    const profile: ExternalAgentProfile = {
      ...profileFor("codex_retry_fail"),
      adapter: "codex",
      command: process.execPath,
      args: ["-e", "console.log('not-json')"],
      autoStart: false,
      allowedRoles: ["coder_a"],
      capabilities: ["coding"],
      strictJson: true,
      normalizationStrictness: "strict"
    };

    await expect(invokeExternalRole({ cwd: process.cwd(), profile, role: "coder_a", prompt: "patch", ledger })).rejects.toThrow("after retry");
    expect(ledger.events).toContainEqual(expect.objectContaining({ type: "external_agent_retry", role: "coder_a", attempt: 2 }));
  });

  it("fails probe before spawning when the configured command is missing", async () => {
    const result = await probeExternalAgent(
      {
        ...profileFor("missing_agent"),
        command: "tomorrowedge-missing-external-agent-command",
        autoStart: true,
        requestTimeoutMs: 100
      },
      process.cwd()
    );

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("command not found");
  });
});

function profileFor(id: string): ExternalAgentProfile {
  return {
    id,
    name: id,
    transport: "mcp",
    capabilities: ["planning", "review"],
    allowedRoles: ["planner", "reviewer"],
    trustLevel: "high",
    requestTimeoutMs: 10_000
  };
}
