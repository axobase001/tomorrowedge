import { describe, expect, it } from "vitest";
import { renderStaticCockpit } from "../../src/cli/renderCockpit.js";
import type { AgentGraphState } from "../../src/core/agentGraph/state.js";

describe("static cockpit fallback", () => {
  it("keeps target, access detail, routing, and recent trace context visible", () => {
    const output = renderStaticCockpit({
      goal: "fix failing test",
      conversationTarget: {
        id: "reviewer",
        kind: "role",
        label: "Reviewer",
        description: "Ask for critique.",
        role: "reviewer"
      },
      access: {
        mode: "partial",
        cloudAllowed: true,
        patchAllowed: true,
        shellAllowed: true,
        repairAllowed: true,
        patchApproved: true,
        shellApproved: true,
        repairApproved: false
      },
      routing: {
        mode: "balanced",
        privacyLocked: false,
        assignments: [
          { role: "planner", provider: "mock", model: "mock-balanced", reason: "test route" },
          { role: "coder_a", provider: "mock", model: "mock-balanced", reason: "test route" },
          { role: "reviewer", provider: "mock", model: "mock-balanced", reason: "test route" },
          { role: "judge", provider: "mock", model: "mock-balanced", reason: "test route" },
          { role: "runner", provider: "local_tool", model: "shell", reason: "test route" }
        ],
        fallbacks: []
      },
      agents: [],
      events: [
        {
          id: "event_1",
          timestamp: "2026-06-04T14:31:00.000Z",
          sessionId: "session_test",
          mode: "partial",
          phase: "routing",
          type: "conversation_target",
          target: "reviewer",
          targetKind: "role",
          label: "Reviewer",
          description: "Ask for critique."
        },
        {
          id: "event_2",
          timestamp: "2026-06-04T14:31:01.000Z",
          sessionId: "session_test",
          mode: "partial",
          phase: "shell",
          role: "runner",
          provider: "local_tool",
          model: "shell",
          type: "shell_run",
          command: "npm test",
          cwd: "/tmp/repo",
          exitCode: 0,
          success: true
        }
      ],
      eventArtifacts: [],
      candidates: [],
      repairCandidates: [],
      debateRounds: [],
      modelNotes: [],
      usageSummary: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      changedFiles: [],
      runResults: [],
      approvals: { patchApproved: true, shellApproved: true, repairApproved: false },
      finalSummary: {
        task: "fix failing test",
        result: "completed",
        changedFiles: [],
        testsRun: [],
        evidence: [],
        risksRemaining: [],
        suggestedCommitMessage: "Fix test"
      }
    } as AgentGraphState);

    expect(output).toContain("Target: reviewer (Reviewer)");
    expect(output).toContain("Access detail: MODE: PARTIAL SUPERVISION - explicit approvals: patch=yes shell=yes repair=no");
    expect(output).toContain("Route: planner:mock/mock-balanced");
    expect(output).toContain("reviewer:mock/mock-balanced");
    expect(output).toContain("Recent events:");
    expect(output).toContain("runner / local_tool/shell: npm test exit=0");
  });
});
