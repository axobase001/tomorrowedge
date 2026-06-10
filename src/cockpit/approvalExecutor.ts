import { loadConfig } from "../config/configLoader.js";
import type { AgentGraphState } from "../core/agentGraph/state.js";
import { SummarizerAgent } from "../core/agents/summarizer.js";
import { applyUnifiedDiffWithResult } from "../core/patch/patchApplier.js";
import { restoreLatestUndoSnapshot } from "../core/patch/undoManager.js";
import { runTestCommand } from "../core/verifier/testRunner.js";
import { evidenceFromRun } from "../core/verifier/evidenceMatcher.js";
import { finalizePostApprovalTrace } from "../core/traces/postApprovalFinalizer.js";
import { makeId } from "../utils/ids.js";
import type { CockpitApprovalIntent } from "./contracts.js";

export type CockpitApprovalExecutionResult = {
  state: AgentGraphState;
  message: string;
};

export async function executeCockpitApprovalAction(cwd: string, state: AgentGraphState, intent: CockpitApprovalIntent): Promise<CockpitApprovalExecutionResult> {
  switch (intent.action) {
    case "approve_patch":
      return approvePatch(cwd, state);
    case "reject_patch":
      return rejectPatch(state, intent.feedback);
    case "approve_shell":
      return approveShell(cwd, state);
    case "reject_shell":
      return rejectShell(state, intent.feedback);
    case "request_re_review":
      return requestReReview(state, intent.feedback);
    case "undo_latest_patch":
      return undoLatestPatch(cwd, state);
  }
}

async function approvePatch(cwd: string, state: AgentGraphState): Promise<CockpitApprovalExecutionResult> {
  const selected = selectedCandidate(state);
  if (!selected?.unifiedDiff) return { state, message: "No patch candidate is available." };
  const isRepair = selected.approach === "repair";
  if (isRepair && !state.access.repairAllowed) return { state, message: accessBlockedMessage(state, "repair") };
  if (!isRepair && !state.access.patchAllowed) return { state, message: accessBlockedMessage(state, "patch") };

  try {
    const applyResult = await applyUnifiedDiffWithResult(cwd, selected.unifiedDiff, true);
    const next = {
      ...state,
      changedFiles: [...new Set([...state.changedFiles, ...applyResult.changedFiles])],
      approvals: isRepair ? { ...state.approvals, repairApproved: true } : { ...state.approvals, patchApproved: true },
      finalSummary: undefined,
      agents: [
        ...resolveWaitingAgents(state, "success", "Patch approved by cockpit operator."),
        {
          id: makeId("cockpit_patch"),
          role: "runner" as const,
          provider: "local_tool",
          model: "patch",
          status: "success" as const,
          summary: `Patch applied: ${applyResult.changedFiles.join(", ")}`
        }
      ],
      events: [
        ...state.events,
        makeEvent(state, {
          type: "patch_apply",
          phase: selected.approach === "repair" ? "repair" : "patch",
          role: "runner",
          provider: "local_tool",
          model: "patch",
          candidateId: selected.candidateId,
          filesChanged: applyResult.changedFiles,
          diffRef: findDiffRef(state, selected.candidateId) ?? writeArtifact(state, "diffs", selected.unifiedDiff, "diff"),
          undoSnapshotIds: applyResult.undoSnapshotIds,
          applied: true
        })
      ]
    };
    return { state: next, message: `Patch applied: ${applyResult.changedFiles.join(", ")}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const next = withFailureSummary({
      ...state,
      approvals: isRepair ? { ...state.approvals, repairApproved: false } : { ...state.approvals, patchApproved: false },
      agents: resolveWaitingAgents(state, "failed", `Patch apply failed: ${message}`),
      events: [
        ...state.events,
        makeEvent(state, {
          type: "patch_apply",
          phase: isRepair ? "repair" : "patch",
          role: "runner",
          provider: "local_tool",
          model: "patch",
          candidateId: selected.candidateId,
          filesChanged: selected.filesChanged,
          diffRef: findDiffRef(state, selected.candidateId) ?? writeArtifact(state, "diffs", selected.unifiedDiff, "diff"),
          undoSnapshotIds: [],
          applied: false,
          error: message
        })
      ]
    }, `Patch apply failed for ${selected.candidateId}: ${message}`);
    return { state: next, message };
  }
}

function rejectPatch(state: AgentGraphState, feedback?: string): CockpitApprovalExecutionResult {
  const selected = selectedCandidate(state);
  const isRepair = selected?.approach === "repair";
  const next = withAbortSummary({
    ...state,
    approvals: isRepair ? { ...state.approvals, repairApproved: false } : { ...state.approvals, patchApproved: false },
    agents: resolveWaitingAgents(state, "failed", "Patch rejected by cockpit operator."),
    events: [
      ...state.events,
      makeEvent(state, {
        type: "patch_apply",
        phase: isRepair ? "repair" : "patch",
        role: "runner",
        provider: "local_cockpit",
        model: "approval",
        candidateId: selected?.candidateId ?? "unknown",
        filesChanged: selected?.filesChanged ?? [],
        diffRef: selected ? findDiffRef(state, selected.candidateId) ?? writeArtifact(state, "diffs", selected.unifiedDiff, "diff") : "",
        undoSnapshotIds: [],
        applied: false,
        error: feedback?.trim() || "rejected by cockpit operator"
      })
    ]
  }, feedback || "Patch rejected by cockpit operator.");
  return { state: next, message: "Patch rejected." };
}

async function approveShell(cwd: string, state: AgentGraphState): Promise<CockpitApprovalExecutionResult> {
  if (!state.access.shellAllowed) return { state, message: accessBlockedMessage(state, "shell") };
  const command = state.plan?.verificationCommands?.[0];
  if (!command) return { state, message: "No verification command is available." };
  if (!state.changedFiles.length) return { state, message: "Apply a patch before running shell verification." };

  const config = loadConfig(cwd);
  const policy = config.shell.policy ?? (state.access.mode === "full" ? "unrestricted" : "verification_allowlist");
  const result = await runTestCommand(cwd, command, { approved: true, policy, verificationAllowlist: config.shell.verification_allowlist });
  const stdoutRef = writeArtifact(state, "stdout", result.stdout || "", "txt");
  const stderrRef = writeArtifact(state, "stderr", result.stderr || "", "txt");
  const summarized = await refreshSummary({
    ...state,
    runResults: [...state.runResults, result],
    approvals: { ...state.approvals, shellApproved: true },
    agents: [
      ...resolveWaitingAgents(state, result.success ? "success" : "failed", `Shell approval executed: ${command}`),
      {
        id: makeId("cockpit_shell"),
        role: "runner" as const,
        provider: "local_tool",
        model: "shell",
        status: result.success ? "success" as const : "failed" as const,
        summary: `${command} exit=${result.exitCode}`
      }
    ],
    events: [
      ...state.events,
      makeEvent(state, {
        type: "shell_run",
        phase: "shell",
        role: "runner",
        provider: "local_tool",
        model: "shell",
        command,
        cwd,
        exitCode: result.exitCode,
        stdoutRef,
        stderrRef,
        durationMs: result.durationMs,
        success: result.success
      })
    ]
  });
  const next = await finalizePostApprovalTrace(cwd, summarized, "browser_cockpit");
  return { state: next, message: result.success ? `Shell verification passed: ${command}` : `Shell verification failed: ${command}` };
}

function rejectShell(state: AgentGraphState, feedback?: string): CockpitApprovalExecutionResult {
  const command = state.plan?.verificationCommands?.[0] ?? "verification command";
  const next = withAbortSummary({
    ...state,
    approvals: { ...state.approvals, shellApproved: false },
    agents: resolveWaitingAgents(state, "failed", "Shell verification rejected by cockpit operator."),
    events: [
      ...state.events,
      makeEvent(state, {
        type: "shell_run",
        phase: "shell",
        role: "runner",
        provider: "local_cockpit",
        model: "approval",
        command,
        cwd: "",
        success: false,
        error: feedback?.trim() || "rejected by cockpit operator"
      })
    ]
  }, feedback || "Shell verification rejected by cockpit operator.");
  return { state: next, message: "Shell verification rejected." };
}

function requestReReview(state: AgentGraphState, feedback?: string): CockpitApprovalExecutionResult {
  const next = {
    ...state,
    review: undefined,
    finalSummary: undefined,
    agents: [
      ...state.agents,
      {
        id: makeId("cockpit_rereview"),
        role: "reviewer" as const,
        provider: "local_cockpit",
        model: "operator",
        status: "waiting_for_user" as const,
        summary: feedback?.trim() || "Operator requested another review pass."
      }
    ],
    events: [
      ...state.events,
      makeEvent(state, {
        type: "review_decision",
        phase: "review",
        role: "reviewer",
        provider: "local_cockpit",
        model: "operator",
        reviewRef: writeArtifact(state, "reviews", feedback?.trim() || "Operator requested another review pass.", "md"),
        recommendation: "re_review_requested"
      })
    ]
  };
  return { state: next, message: "Re-review requested." };
}

async function undoLatestPatch(cwd: string, state: AgentGraphState): Promise<CockpitApprovalExecutionResult> {
  if (!state.access.patchAllowed) return { state, message: accessBlockedMessage(state, "undo") };
  const restored = await restoreLatestUndoSnapshot(cwd);
  const next = {
    ...state,
    changedFiles: state.changedFiles.filter((file) => file !== restored.restoredPath),
    finalSummary: undefined,
    events: [
      ...state.events,
      makeEvent(state, {
        type: "patch_apply",
        phase: "patch",
        role: "runner",
        provider: "local_tool",
        model: "undo",
        candidateId: "undo_latest_patch",
        filesChanged: [restored.restoredPath],
        diffRef: writeArtifact(state, "diffs", `Restored ${restored.restoredPath} from ${restored.snapshotId}`, "txt"),
        undoSnapshotIds: [restored.snapshotId],
        applied: false,
        error: "undo_latest_patch"
      })
    ],
    agents: [
      ...state.agents,
      {
        id: makeId("cockpit_undo"),
        role: "runner" as const,
        provider: "local_tool",
        model: "undo",
        status: "success" as const,
        summary: `Undo restored ${restored.restoredPath}`
      }
    ]
  };
  return { state: next, message: `Undo restored ${restored.restoredPath}.` };
}

function selectedCandidate(state: AgentGraphState) {
  const pendingRepair = state.repairCandidates.at(-1);
  if (pendingRepair && state.agents.some((agent) => agent.status === "waiting_for_user" && agent.role === "runner")) return pendingRepair;
  const candidates = [...state.candidates, ...state.repairCandidates];
  return candidates.find((candidate) => candidate.candidateId === state.judge?.selectedCandidateId) ?? candidates[0];
}

async function refreshSummary(state: AgentGraphState): Promise<AgentGraphState> {
  if (!state.plan) return state;
  const summarizer = new SummarizerAgent();
  const finalSummary = await summarizer.run({
    plan: state.plan,
    changedFiles: state.changedFiles,
    testsRun: state.runResults.map((result) => result.command),
    evidence: ["browser cockpit action executed", ...state.runResults.map(evidenceFromRun)]
  });
  return {
    ...state,
    finalSummary,
    events: [
      ...state.events,
      makeEvent(state, {
        type: "summary",
        phase: "summary",
        role: "summarizer",
        provider: "local_cockpit",
        model: "browser",
        summaryRef: writeArtifact(state, "summaries", JSON.stringify(finalSummary, null, 2), "json"),
        result: finalSummary.result
      })
    ]
  };
}

function withAbortSummary(state: AgentGraphState, reason: string): AgentGraphState {
  return {
    ...state,
    finalSummary: {
      task: state.goal,
      result: "aborted",
      userReply: `I stopped this workflow because the approval was not granted: ${reason}`,
      userReplySource: "local",
      changedFiles: state.changedFiles,
      testsRun: state.runResults.map((result) => result.command),
      evidence: [reason],
      risksRemaining: [reason],
      suggestedCommitMessage: "chore: no cockpit-approved change"
    }
  };
}

function withFailureSummary(state: AgentGraphState, reason: string): AgentGraphState {
  return {
    ...state,
    finalSummary: {
      task: state.goal,
      result: "failed",
      userReply: `I could not complete the approved action safely. ${reason}`,
      userReplySource: "local",
      changedFiles: state.changedFiles,
      testsRun: state.runResults.map((result) => result.command),
      evidence: [reason],
      risksRemaining: [reason],
      suggestedCommitMessage: "chore: resolve cockpit patch conflict"
    }
  };
}

function findDiffRef(state: AgentGraphState, candidateId: string): string | undefined {
  const event = [...state.events].reverse().find((item) => item.type === "patch_candidate" && item.candidateId === candidateId);
  return event?.type === "patch_candidate" ? event.diffRef : undefined;
}

function writeArtifact(state: AgentGraphState, kind: string, content: string, extension: string): string {
  const ref = `artifacts/${kind}/${makeId(kind)}.${extension}`;
  state.eventArtifacts.push({ ref, content });
  return ref;
}

function makeEvent(state: AgentGraphState, event: Record<string, unknown>) {
  return {
    ...event,
    id: makeId(String(event.type ?? "event")),
    timestamp: new Date().toISOString(),
    sessionId: state.sessionId,
    mode: state.access.mode
  } as AgentGraphState["events"][number];
}

function accessBlockedMessage(state: AgentGraphState, action: "patch" | "repair" | "shell" | "undo"): string {
  return `Current ${state.access.mode} access mode does not allow ${action} from the browser cockpit.`;
}

function resolveWaitingAgents(state: AgentGraphState, status: "success" | "failed", summary: string): AgentGraphState["agents"] {
  return state.agents.map((agent) => agent.status === "waiting_for_user" ? { ...agent, status, summary } : agent);
}
