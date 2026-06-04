import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";
import { createConversationSession } from "../../src/core/conversation/conversationSession.js";
import { listConversationTargets, resolveConversationTarget } from "../../src/core/conversation/conversationTargets.js";
import { askCommand, targetsCommand } from "../../src/cli/commands/conversation.js";

describe("conversation targets", () => {
  it("lists core, role, debate, and enabled external agent targets", () => {
    const config = {
      ...defaultConfig,
      external_agents: {
        codex: {
          ...defaultConfig.external_agents.codex,
          enabled: true
        }
      }
    };

    expect(listConversationTargets(config).map((target) => target.id)).toEqual(expect.arrayContaining(["core", "planner", "reviewer", "judge", "debate", "agent:codex"]));
    expect(resolveConversationTarget(config, "external:codex").id).toBe("agent:codex");
  });

  it("records directed ask sessions as non-mutating conversation events", async () => {
    const state = createConversationSession({ message: "is this patch safe?", target: "reviewer", config: defaultConfig });

    expect(state.conversationTarget?.id).toBe("reviewer");
    expect(state.events.map((event) => event.type)).toEqual(["conversation_target", "conversation_message", "summary"]);
    expect(state.finalSummary?.changedFiles).toEqual([]);
    expect(state.finalSummary?.testsRun).toEqual([]);
  });

  it("records conversation target events in a normal run graph", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const state = await runOfflineGraph(cwd, "review the fixture patch", defaultConfig, {
      provider: "fixture",
      conversationTarget: "debate"
    });

    expect(state.conversationTarget?.id).toBe("debate");
    expect(state.finalSummary?.task).toBe("review the fixture patch");
    expect(state.events.some((event) => event.type === "conversation_target" && event.target === "debate")).toBe(true);
    expect(state.events.some((event) => event.type === "conversation_message" && event.target === "debate")).toBe(true);
  });

  it("prints targets and saves ask command sessions", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-conversation-"));
    try {
      const targetsOutput = await captureStdout(() => targetsCommand(cwd));
      expect(targetsOutput).toContain("Conversation targets");
      expect(targetsOutput).toContain("reviewer");

      const askOutput = await captureStdout(() => askCommand(cwd, "judge this", { to: "judge" }));
      expect(askOutput).toContain("Conversation target: judge");
      const sessionPath = askOutput.match(/Session: (.+)/)?.[1]?.trim();
      expect(sessionPath).toBeTruthy();
      const sessionText = await readFile(sessionPath!, "utf8");
      expect(sessionText).toContain("\"conversationTarget\"");
      expect(sessionText).toContain("\"judge\"");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

async function captureStdout(fn: () => Promise<void> | void): Promise<string> {
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
