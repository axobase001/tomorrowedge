import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { diagnosticsCommand } from "../../src/cli/commands/diagnostics.js";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { createConversationSession } from "../../src/core/conversation/conversationSession.js";
import { saveSession } from "../../src/core/memory/sessionMemory.js";

describe("diagnostics command", () => {
  it("treats 'on' as a session id when such a session exists", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-diagnostics-on-"));
    try {
      const state = {
        ...createConversationSession({ message: "diagnose this", target: "core", config: defaultConfig }),
        sessionId: "on"
      };
      await saveSession(cwd, state);

      const output = await captureStdout(() => diagnosticsCommand(cwd, "on"));

      expect(output).toContain("Trace Diagnostics");
      expect(output).not.toContain("Diagnostics are recorded automatically");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }
  return output;
}
