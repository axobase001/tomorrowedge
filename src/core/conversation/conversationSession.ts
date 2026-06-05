import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { AgentGraphState } from "../agentGraph/state.js";
import { buildAccessPolicy } from "../permissions/accessPolicy.js";
import { ModelRouter } from "../routing/router.js";
import { createEventLedger } from "../events/eventLedger.js";
import { resolveConversationTarget, targetPromptPrefix } from "./conversationTargets.js";
import type { ConversationTarget } from "../../schemas/conversation.js";

export type ConversationSessionInput = {
  message: string;
  target?: string;
  config: TomorrowEdgeConfig;
};

export function createConversationSession(input: ConversationSessionInput): AgentGraphState {
  const access = buildAccessPolicy(input.config, { mode: "restricted" });
  const router = new ModelRouter(input.config);
  const ledger = createEventLedger(access.mode);
  const target = resolveConversationTarget(input.config, input.target);
  const messageRef = ledger.writeArtifact("conversation_messages", input.message);
  ledger.append({
    type: "conversation_target",
    phase: "routing",
    target: target.id,
    targetKind: target.kind,
    label: target.label,
    description: target.description
  });
  ledger.append({
    type: "conversation_message",
    phase: "routing",
    target: target.id,
    targetKind: target.kind,
    messageRef,
    summary: summarizeConversation(input.message, target)
  });
  const finalSummary = {
    task: input.message,
    result: "completed" as const,
    changedFiles: [],
    testsRun: [],
    evidence: [targetPromptPrefix(target), `Conversation target: ${target.id}`],
    risksRemaining: ["This was a non-mutating directed conversation trace; no patch or shell command was run."],
    suggestedCommitMessage: "Record directed TomorrowEdge conversation"
  };
  ledger.append({
    type: "summary",
    phase: "summary",
    role: "summarizer",
    summaryRef: ledger.writeArtifact("summaries", JSON.stringify(finalSummary, null, 2), "json"),
    result: finalSummary.result
  });
  return {
    sessionId: ledger.sessionId,
    goal: input.message,
    conversationTarget: target,
    routing: router.getPlan(),
    access,
    events: ledger.events,
    eventArtifacts: ledger.artifacts,
    providerViews: [],
    evidencePackets: [],
    agents: [],
    candidates: [],
    repairCandidates: [],
    debateRounds: [],
    modelNotes: [],
    usageSummary: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    budgetStatuses: [],
    changedFiles: [],
    runResults: [],
    approvals: {
      patchApproved: access.patchApproved,
      shellApproved: access.shellApproved,
      repairApproved: access.repairApproved
    },
    finalSummary
  };
}

function summarizeConversation(message: string, target: ConversationTarget): string {
  const compact = message.replace(/\s+/g, " ").trim();
  return `${target.id}: ${compact.slice(0, 120)}${compact.length > 120 ? "..." : ""}`;
}
