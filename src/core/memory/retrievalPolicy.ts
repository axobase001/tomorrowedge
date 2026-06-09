import type { FailureMemoryExplanation, FailureMemoryRecord } from "./taskMemory.js";

export type MemoryRetrievalPolicyMode = "balanced" | "exploit_memory" | "explore_alternative" | "random_control";

export type MemoryRetrievalPolicyAction = "exploit" | "bypass";

export type MemoryRetrievalPolicyDecision = {
  mode: MemoryRetrievalPolicyMode;
  action: MemoryRetrievalPolicyAction;
  selectedBefore: number;
  selectedAfter: number;
  bypassedMemoryIds: string[];
  reason: string;
};

export function applyMemoryRetrievalPolicy(
  explanation: FailureMemoryExplanation,
  mode: MemoryRetrievalPolicyMode,
  seed = ""
): { explanation: FailureMemoryExplanation; decision: MemoryRetrievalPolicyDecision } {
  const selectedBefore = explanation.selected.length;
  if (!selectedBefore) {
    return {
      explanation,
      decision: {
        mode,
        action: "bypass",
        selectedBefore,
        selectedAfter: 0,
        bypassedMemoryIds: [],
        reason: "No eligible failure memories were selected before policy filtering."
      }
    };
  }
  const shouldExploit = shouldExploitMemory(explanation, mode, seed);
  if (shouldExploit) {
    return {
      explanation,
      decision: {
        mode,
        action: "exploit",
        selectedBefore,
        selectedAfter: selectedBefore,
        bypassedMemoryIds: [],
        reason: exploitReason(explanation, mode)
      }
    };
  }
  const bypassedMemoryIds = explanation.selected.map((record) => record.id);
  return {
    explanation: {
      ...explanation,
      selected: [],
      rejected: [
        ...explanation.rejected,
        ...explanation.selected.map((record) => ({ id: record.id, reason: `memory policy ${mode} bypassed retrieval for exploration/control` }))
      ]
    },
    decision: {
      mode,
      action: "bypass",
      selectedBefore,
      selectedAfter: 0,
      bypassedMemoryIds,
      reason: bypassReason(explanation, mode, seed)
    }
  };
}

function shouldExploitMemory(explanation: FailureMemoryExplanation, mode: MemoryRetrievalPolicyMode, seed: string): boolean {
  if (mode === "exploit_memory") return true;
  if (mode === "explore_alternative") return false;
  if (mode === "random_control") return stableHash(`${seed}|${explanation.task}|${explanation.selected.map((record) => record.id).join(",")}`) % 2 === 0;
  const top = explanation.selected[0];
  if (!top) return false;
  return top.score >= 3 && top.confidence >= 0.55 && !hasNegativeTransferSignal(top);
}

function hasNegativeTransferSignal(record: FailureMemoryRecord): boolean {
  return (record.recurrenceCount ?? record.recurrence ?? 1) >= 2 && (record.fixedCount ?? 0) === 0;
}

function exploitReason(explanation: FailureMemoryExplanation, mode: MemoryRetrievalPolicyMode): string {
  const top = explanation.selected[0];
  if (mode === "exploit_memory") return `Forced exploit_memory mode selected ${explanation.selected.length} memory record(s).`;
  if (mode === "random_control") return "Deterministic random_control selected exploit arm.";
  return top
    ? `Balanced policy exploited memory ${top.id} with score=${top.score} confidence=${top.confidence.toFixed(2)}.`
    : "Balanced policy found no top memory but left selection unchanged.";
}

function bypassReason(explanation: FailureMemoryExplanation, mode: MemoryRetrievalPolicyMode, seed: string): string {
  if (mode === "explore_alternative") return `Forced explore_alternative mode bypassed ${explanation.selected.length} memory record(s).`;
  if (mode === "random_control") return `Deterministic random_control bypassed memory for seed=${seed || "default"}.`;
  const top = explanation.selected[0];
  if (!top) return "Balanced policy bypassed because no selected memory was available.";
  if (hasNegativeTransferSignal(top)) return `Balanced policy bypassed ${top.id} because recurrence=${top.recurrenceCount} fixed=${top.fixedCount} suggests negative transfer.`;
  return `Balanced policy bypassed ${top.id} because score=${top.score} confidence=${top.confidence.toFixed(2)} was below exploitation threshold.`;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
