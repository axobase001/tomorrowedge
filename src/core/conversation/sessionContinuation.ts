import type { AgentGraphState } from "../agentGraph/state.js";
import type { EventArtifact, TomorrowEdgeEvent } from "../events/eventTypes.js";
import { resolveConversationTarget, targetPromptPrefix } from "./conversationTargets.js";
import type { TomorrowEdgeConfig } from "../../config/schema.js";
import { redactText } from "../../safety/secretScanner.js";
import { makeId } from "../../utils/ids.js";

export type SessionContinuationInput = {
  state: AgentGraphState;
  message: string;
  target?: string;
  config: TomorrowEdgeConfig;
};

export type SessionContinuationResult = {
  state: AgentGraphState;
  turnId: string;
  contextArtifactRef: string;
};

const maxMessageChars = 8_000;
const maxProjectedChars = 6_000;

export function appendSessionContinuation(input: SessionContinuationInput): SessionContinuationResult {
  const message = normalizeContinuationMessage(input.message);
  const target = resolveConversationTarget(input.config, input.target);
  const turnId = makeId("turn");
  const timestamp = new Date().toISOString();
  const mode = input.state.access.mode;
  const contextProjection = buildContinuationProjection(input.state, message, target.id);
  const contextArtifactRef = continuationArtifactRef("context_projection", turnId, "md");
  const messageRef = continuationArtifactRef("conversation_messages", turnId, "txt");
  const assistantRef = continuationArtifactRef("conversation_messages", `${turnId}_ack`, "md");
  const projected = clipText(redactText(contextProjection), maxProjectedChars);
  const sanitizedMessage = redactText(message);
  const assistantBody = [
    "Continuation recorded in this session.",
    "",
    "This initial continuation path preserves the selected session context, target, and bounded projection for a later follow-up run. It does not yet dispatch a provider call or mutate files."
  ].join("\n");
  const base = {
    timestamp,
    sessionId: input.state.sessionId,
    mode
  };
  const events: TomorrowEdgeEvent[] = [
    {
      ...base,
      id: makeId("conversation_message"),
      type: "conversation_message",
      phase: "routing",
      target: target.id,
      targetKind: target.kind,
      messageRef,
      speaker: "user",
      turnId,
      continuation: true,
      summary: summarizeContinuation(sanitizedMessage, target.id)
    },
    {
      ...base,
      id: makeId("context_projection"),
      type: "context_projection",
      phase: "routing",
      selectedArtifacts: selectedArtifactRefs(input.state),
      projectedArtifacts: [contextArtifactRef],
      tokenEstimate: estimateTokens(projected),
      omittedBytes: Math.max(0, contextProjection.length - projected.length),
      policySummary: "Session continuation uses a bounded, redacted projection of goal, final summary, recent messages, trace, evidence, and artifacts. Provider dispatch is intentionally deferred."
    },
    {
      ...base,
      id: makeId("conversation_message"),
      type: "conversation_message",
      phase: "delivery",
      target: target.id,
      targetKind: target.kind,
      messageRef: assistantRef,
      speaker: "assistant",
      turnId,
      continuation: true,
      summary: "Continuation context captured; follow-up execution is not yet dispatched."
    }
  ];
  const artifacts: EventArtifact[] = [
    { ref: messageRef, content: sanitizedMessage },
    { ref: contextArtifactRef, content: projected },
    { ref: assistantRef, content: assistantBody }
  ];
  const continuationReply = buildContinuationReply(input.state, sanitizedMessage, target.id);
  return {
    turnId,
    contextArtifactRef,
    state: {
      ...input.state,
      conversationTarget: target,
      events: [...input.state.events, ...events],
      eventArtifacts: [...input.state.eventArtifacts, ...artifacts],
      finalSummary: {
        task: input.state.finalSummary?.task ?? input.state.goal,
        result: input.state.finalSummary?.result ?? "completed",
        userReply: continuationReply,
        userReplySource: "system",
        changedFiles: input.state.finalSummary?.changedFiles ?? input.state.changedFiles,
        testsRun: input.state.finalSummary?.testsRun ?? input.state.runResults.map((result) => result.command),
        evidence: [
          ...(input.state.finalSummary?.evidence ?? []),
          targetPromptPrefix(target),
          `Continuation turn recorded: ${turnId}`,
          `Continuation context projection: ${contextArtifactRef}`
        ],
        risksRemaining: [
          ...(input.state.finalSummary?.risksRemaining ?? []),
          "Continuation currently records bounded context and message history only; provider-backed follow-up execution remains planned work."
        ],
        suggestedCommitMessage: input.state.finalSummary?.suggestedCommitMessage ?? "Record cockpit session continuation",
        statusBreakdown: input.state.finalSummary?.statusBreakdown
      }
    }
  };
}

function normalizeContinuationMessage(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("message_required");
  return trimmed.length > maxMessageChars ? trimmed.slice(0, maxMessageChars) : trimmed;
}

function buildContinuationProjection(state: AgentGraphState, message: string, targetId: string): string {
  const previousMessages = state.events
    .filter((event) => event.type === "conversation_message")
    .slice(-6)
    .map((event) => `- ${event.speaker ?? "message"} ${event.continuation ? "(continuation)" : ""}: ${event.summary}`);
  const recentTrace = state.events.slice(-12).map((event) => `- ${event.type}: ${"summary" in event && typeof event.summary === "string" ? event.summary : event.type}`);
  const evidence = state.finalSummary?.evidence.slice(-8).map((item) => `- ${item}`) ?? [];
  const risks = state.finalSummary?.risksRemaining.slice(-6).map((item) => `- ${item}`) ?? [];
  return [
    "# Session Continuation Context",
    "",
    `Session: ${state.sessionId}`,
    `Target: ${targetId}`,
    `Goal: ${state.goal}`,
    "",
    "## Follow-up",
    message,
    "",
    "## Final Summary",
    state.finalSummary
      ? [
        `Result: ${state.finalSummary.result}`,
        `Changed files: ${state.finalSummary.changedFiles.join(", ") || "none"}`,
        `Tests: ${state.finalSummary.testsRun.join(", ") || "not run"}`
      ].join("\n")
      : "No final summary recorded yet.",
    "",
    "## Recent Conversation",
    previousMessages.length ? previousMessages.join("\n") : "No prior conversation turns recorded.",
    "",
    "## Evidence",
    evidence.length ? evidence.join("\n") : "No summary evidence recorded.",
    "",
    "## Remaining Risks",
    risks.length ? risks.join("\n") : "No summary risks recorded.",
    "",
    "## Recent Trace",
    recentTrace.length ? recentTrace.join("\n") : "No trace events recorded.",
    "",
    "## Artifact Handles",
    selectedArtifactRefs(state).length ? selectedArtifactRefs(state).map((ref) => `- ${ref}`).join("\n") : "No artifacts recorded."
  ].join("\n");
}

function buildContinuationReply(state: AgentGraphState, message: string, targetId: string): string {
  const sections = [
    "I recorded this follow-up in the selected session and prepared a bounded continuation context for later execution.",
    "",
    `Target: ${targetId}`,
    `Follow-up: ${message}`,
    "",
    "Current limitation: this PR establishes the same-session message and context-projection contract. It does not yet perform provider-backed follow-up reasoning or model-specific context-window packing."
  ];
  if (state.finalSummary?.userReply) {
    sections.push("", "Previous answer remains available in the session details.");
  }
  return sections.join("\n");
}

function summarizeContinuation(message: string, targetId: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  return `follow-up to ${targetId}: ${compact.slice(0, 140)}${compact.length > 140 ? "..." : ""}`;
}

function selectedArtifactRefs(state: AgentGraphState): string[] {
  return state.eventArtifacts.map((artifact) => artifact.ref).slice(-12);
}

function continuationArtifactRef(kind: string, id: string, extension: string): string {
  return `artifacts/${kind}/${id}.${extension}`;
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated]`;
}
