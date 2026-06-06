import type { CockpitApprovalIntent } from "./contracts.js";

export type RecordedApprovalIntent = CockpitApprovalIntent & {
  id: string;
  createdAt: string;
};

const intents = new Map<string, RecordedApprovalIntent[]>();

export function recordApprovalIntent(intent: CockpitApprovalIntent): RecordedApprovalIntent {
  const recorded = {
    ...intent,
    id: `intent_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString()
  };
  const list = intents.get(intent.sessionId) ?? [];
  list.push(recorded);
  intents.set(intent.sessionId, list);
  return recorded;
}

export function listApprovalIntents(sessionId: string): RecordedApprovalIntent[] {
  return intents.get(sessionId) ?? [];
}
