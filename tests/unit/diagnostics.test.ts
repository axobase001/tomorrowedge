import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { diagnosticsCommand } from "../../src/cli/commands/diagnostics.js";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { createConversationSession } from "../../src/core/conversation/conversationSession.js";
import { computeTraceCompleteness } from "../../src/core/diagnostics/traceCompleteness.js";
import { saveSession } from "../../src/core/memory/sessionMemory.js";
import type { TomorrowEdgeEvent } from "../../src/core/events/eventTypes.js";

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

describe("trace completeness rubric", () => {
  it("does not require patch workflow events for read-only sessions", () => {
    const events = [
      event("access_mode"),
      event("conversation_message"),
      event("workflow_intent", { intent: "inspect", requiresPatchWorkflow: false, confidence: 0.95, reason: "read-only" }),
      event("evidence_update", { evidence: ["plan"] }),
      event("context_select", { selectedFiles: [], excludedFiles: [], summary: "none" }),
      event("budget_preview", { status: "allowed", reason: "preview" }),
      event("summary", { summaryRef: "summaries/x", result: "completed" }),
      event("workflow_stop_reason", { reason: "read-only request completed without patch workflow", result: "completed" })
    ] as TomorrowEdgeEvent[];

    const score = computeTraceCompleteness(events, { workflowKind: "read_only" });

    expect(score.score).toBeGreaterThanOrEqual(90);
    expect(score.missing).not.toContain("candidate patch recorded");
    expect(score.missing).not.toContain("review recorded");
    expect(score.missing).not.toContain("judge decision recorded");
    expect(score.missing).not.toContain("shell run recorded");
  });
});

function event(type: TomorrowEdgeEvent["type"], extra: Record<string, unknown> = {}): TomorrowEdgeEvent {
  return {
    id: `evt_${type}`,
    timestamp: "2026-06-09T00:00:00.000Z",
    sessionId: "session_test",
    mode: "partial",
    phase: "summary",
    type,
    ...extra
  } as TomorrowEdgeEvent;
}

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
