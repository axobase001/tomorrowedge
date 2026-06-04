import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEventLedger } from "../../src/core/events/eventLedger.js";
import { buildExternalAgentEnv, isCodexCommand } from "../../src/core/externalAgents/externalAgentProcess.js";
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
