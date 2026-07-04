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
  mode?: "conversation" | "followup_run";
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
  const continuationMode = input.mode ?? "conversation";
  const contextProjection = buildContinuationProjection(input.state, message, target.id);
  const contextArtifactRef = continuationArtifactRef("context_projection", turnId, "md");
  const messageRef = continuationArtifactRef("conversation_messages", turnId, "txt");
  const assistantRef = continuationArtifactRef("conversation_messages", `${turnId}_ack`, "md");
  const projected = clipText(redactText(contextProjection), maxProjectedChars);
  const sanitizedMessage = redactText(message);
  const assistantBody = [
    continuationMode === "followup_run" ? "Continuation run started in this session." : "Continuation recorded in this session.",
    "",
    continuationMode === "followup_run"
      ? "This continuation path preserves the selected session context, target, and bounded projection before dispatching the follow-up through the governed run pipeline."
      : "This continuation path preserves the selected session context, target, and bounded projection without dispatching a provider call or mutating files."
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
      policySummary: continuationMode === "followup_run"
        ? "Session continuation uses a bounded, redacted projection of goal, final summary, recent messages, trace, evidence, and artifacts before dispatching a governed follow-up run."
        : "Session continuation uses a bounded, redacted projection of goal, final summary, recent messages, trace, evidence, and artifacts. Provider dispatch is intentionally deferred."
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
      summary: continuationMode === "followup_run"
        ? "Continuation context captured; follow-up run started."
        : "Continuation context captured; follow-up execution is not yet dispatched."
    }
  ];
  const artifacts: EventArtifact[] = [
    { ref: messageRef, content: sanitizedMessage },
    { ref: contextArtifactRef, content: projected },
    { ref: assistantRef, content: assistantBody }
  ];
  const continuationReply = buildContinuationReply(input.state, sanitizedMessage, target.id, continuationMode);
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
          ...(continuationMode === "followup_run" ? [] : ["Continuation currently records bounded context and message history only; provider-backed follow-up execution remains planned work."])
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

function buildContinuationReply(state: AgentGraphState, message: string, targetId: string, mode: "conversation" | "followup_run"): string {
  const sections = [
    mode === "followup_run"
      ? "I recorded this follow-up in the selected session and started a governed continuation run with bounded context."
      : "I recorded this follow-up in the selected session and prepared a bounded continuation context.",
    "",
    `Target: ${targetId}`,
    `Follow-up: ${message}`
  ];
  if (mode === "conversation") {
    sections.push(
      "",
      "This mode records the turn only; use followup_run mode to dispatch the continuation through the governed run pipeline."
    );
  }
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
