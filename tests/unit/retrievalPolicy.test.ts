import { describe, expect, it } from "vitest";
import { applyMemoryRetrievalPolicy } from "../../src/core/memory/retrievalPolicy.js";
import type { FailureMemoryExplanation, FailureMemoryRecord } from "../../src/core/memory/taskMemory.js";

describe("memory retrieval policy", () => {
  it("forces exploitation when configured", () => {
    const explanation = explanationWith(record({ id: "failure_a", score: 1, confidence: 0.2 }));
    const result = applyMemoryRetrievalPolicy(explanation, "exploit_memory", "seed");

    expect(result.decision.action).toBe("exploit");
    expect(result.decision.selectedBefore).toBe(1);
    expect(result.decision.selectedAfter).toBe(1);
    expect(result.explanation.selected.map((item) => item.id)).toEqual(["failure_a"]);
  });

  it("forces exploration by bypassing selected memories", () => {
    const explanation = explanationWith(record({ id: "failure_b", score: 5, confidence: 0.9 }));
    const result = applyMemoryRetrievalPolicy(explanation, "explore_alternative", "seed");

    expect(result.decision.action).toBe("bypass");
    expect(result.decision.bypassedMemoryIds).toEqual(["failure_b"]);
    expect(result.explanation.selected).toEqual([]);
    expect(result.explanation.rejected.map((item) => item.id)).toContain("failure_b");
  });

  it("exploits high-confidence balanced memories", () => {
    const explanation = explanationWith(record({ id: "failure_c", score: 4, confidence: 0.7 }));
    const result = applyMemoryRetrievalPolicy(explanation, "balanced", "seed");

    expect(result.decision.action).toBe("exploit");
    expect(result.decision.reason).toContain("score=4");
  });

  it("bypasses likely negative transfer in balanced mode", () => {
    const explanation = explanationWith(record({ id: "failure_d", score: 5, confidence: 0.8, recurrenceCount: 3, fixedCount: 0 }));
    const result = applyMemoryRetrievalPolicy(explanation, "balanced", "seed");

    expect(result.decision.action).toBe("bypass");
    expect(result.decision.reason).toContain("negative transfer");
    expect(result.explanation.selected).toEqual([]);
  });

  it("keeps random control deterministic for the same seed", () => {
    const explanation = explanationWith(record({ id: "failure_e", score: 5, confidence: 0.9 }));
    const first = applyMemoryRetrievalPolicy(explanation, "random_control", "same-seed");
    const second = applyMemoryRetrievalPolicy(explanation, "random_control", "same-seed");

    expect(second.decision.action).toBe(first.decision.action);
    expect(second.decision.bypassedMemoryIds).toEqual(first.decision.bypassedMemoryIds);
  });
});

function explanationWith(selected: FailureMemoryExplanation["selected"][number]): FailureMemoryExplanation {
  return {
    task: "fix failing test",
    selected: [selected],
    rejected: []
  };
}

function record(input: {
  id: string;
  score: number;
  confidence: number;
  recurrenceCount?: number;
  fixedCount?: number;
}): FailureMemoryExplanation["selected"][number] {
  const now = "2026-06-10T00:00:00.000Z";
  const base: FailureMemoryRecord = {
    id: input.id,
    schemaVersion: "task-memory/v2",
    createdAt: now,
    firstSeen: now,
    lastSeen: now,
    goalFingerprint: input.id,
    goalPreview: "fix failing test",
    taskType: "bugfix",
    riskLevel: "low",
    routingMode: "balanced",
    accessMode: "partial",
    constraints: [],
    verificationCommands: ["npm test"],
    result: "failed",
    failureClass: "validation_failed",
    failureSignature: input.id,
    correction: "Run the verifier after patching.",
    evidenceRefs: [],
    confidence: input.confidence,
    recurrence: input.recurrenceCount ?? 1,
    recurrenceCount: input.recurrenceCount ?? 1,
    fixedCount: input.fixedCount ?? 1,
    sourceSessionIds: ["session_a"],
    stale: false
  };
  return {
    ...base,
    score: input.score,
    matchedSignals: ["task"]
  };
}
