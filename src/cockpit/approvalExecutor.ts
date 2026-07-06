import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config/configLoader.js";
import type { AgentGraphState } from "../core/agentGraph/state.js";
import { SummarizerAgent } from "../core/agents/summarizer.js";
import { applyUnifiedDiffWithResult } from "../core/patch/patchApplier.js";
import { restoreLatestUndoSnapshot } from "../core/patch/undoManager.js";
import { runTestCommand } from "../core/verifier/testRunner.js";
import { evidenceFromRun } from "../core/verifier/evidenceMatcher.js";
import { finalizePostApprovalTrace } from "../core/traces/postApprovalFinalizer.js";
import { effectiveShellPolicy } from "../core/tools/shellPolicy.js";
import { makeId } from "../utils/ids.js";
import type { CockpitApprovalIntent } from "./contracts.js";
import { resolveCockpitShellCommand } from "./verificationCommand.js";

export type CockpitApprovalExecutionResult = {
  state: AgentGraphState;
  message: string;
  status: "applied" | "executed" | "failed" | "rejected" | "revision_requested" | "undone" | "blocked";
};

export async function executeCockpitApprovalAction(
  cwd: string,
  state: AgentGraphState,
  intent: CockpitApprovalIntent,
  options: { executionCwd?: string; traceCwd?: string } = {}
): Promise<CockpitApprovalExecutionResult> {
  const executionCwd = options.executionCwd ?? cwd;
  const traceCwd = options.traceCwd ?? cwd;
  switch (intent.action) {
    case "approve_patch":
      return approvePatch(executionCwd, state);
    case "reject_patch":
      return rejectPatch(state, intent.feedback);
    case "approve_shell":
      return approveShell({ configCwd: cwd, executionCwd, traceCwd, state });
    case "reject_shell":
      return rejectShell(state, intent.feedback);
    case "request_re_review":
      return requestReReview(state, intent.feedback);
    case "undo_latest_patch":
      return undoLatestPatch(executionCwd, state);
  }
}

async function approvePatch(cwd: string, state: AgentGraphState): Promise<CockpitApprovalExecutionResult> {
  const selected = selectedCandidate(state);
  if (!selected?.unifiedDiff) return { state, message: "No patch candidate is available.", status: "blocked" };
  const isRepair = selected.approach === "repair";
  if (isRepair && !state.access.repairAllowed) return { state, message: accessBlockedMessage(state, "repair"), status: "blocked" };
  if (!isRepair && !state.access.patchAllowed) return { state, message: accessBlockedMessage(state, "patch"), status: "blocked" };

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
    return { state: next, message: `Patch applied: ${applyResult.changedFiles.join(", ")}`, status: "applied" };
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
    return { state: next, message, status: "failed" };
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
  return { state: next, message: "Patch rejected.", status: "rejected" };
}

async function approveShell(input: { configCwd: string; executionCwd: string; traceCwd: string; state: AgentGraphState }): Promise<CockpitApprovalExecutionResult> {
  const { configCwd, executionCwd, traceCwd, state } = input;
  if (!state.access.shellAllowed) return { state, message: accessBlockedMessage(state, "shell"), status: "blocked" };
  const command = resolveCockpitShellCommand(state);
  if (!command) {
    const structuralResult = await runStructuralDeliverableVerifier(executionCwd, state);
    const next = await finalizePostApprovalTrace(traceCwd, await refreshSummary({
      ...state,
      runResults: structuralResult ? [...state.runResults, structuralResult] : state.runResults,
      approvals: { ...state.approvals, shellApproved: true },
      agents: [
        ...resolveWaitingAgents(state, "success", structuralResult ? "Shell approval acknowledged; structural deliverable verifier passed." : "Shell approval acknowledged; no verification command was available."),
        {
          id: makeId("cockpit_shell"),
          role: "runner" as const,
          provider: "local_tool",
          model: "shell",
          status: "success" as const,
          summary: structuralResult ? "Structural deliverable verifier passed." : "No verification command was available."
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
          command: "verification command",
          cwd: executionCwd,
          success: true,
          skipped: true,
          skipReason: "no verification command available"
        })
      ]
    }), "browser_cockpit");
    return {
      state: next,
      message: structuralResult ? "No verification command is available; structural deliverable verification passed." : "No verification command is available.",
      status: "executed"
    };
  }
  if (!state.changedFiles.length) return { state, message: "Apply a patch before running shell verification.", status: "blocked" };

  const config = loadConfig(configCwd);
  const policy = effectiveShellPolicy(config.shell.policy);
  let result: Awaited<ReturnType<typeof runTestCommand>>;
  try {
    result = await runTestCommand(executionCwd, command, { approved: true, policy, verificationAllowlist: config.shell.verification_allowlist });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const blocked = withFailureSummary({
      ...state,
      agents: [
        ...resolveWaitingAgents(state, "failed", `Shell approval blocked: ${command}`),
        {
          id: makeId("cockpit_shell_blocked"),
          role: "runner" as const,
          provider: "local_tool",
          model: "shell",
          status: "failed" as const,
          summary: message
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
          cwd: executionCwd,
          error: message
        })
      ]
    }, message);
    return { state: blocked, message, status: "blocked" };
  }
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
        cwd: executionCwd,
        exitCode: result.exitCode,
        stdoutRef,
        stderrRef,
        durationMs: result.durationMs,
        success: result.success
      })
    ]
  });
  const next = await finalizePostApprovalTrace(traceCwd, summarized, "browser_cockpit");
  return { state: next, message: result.success ? `Shell verification passed: ${command}` : `Shell verification failed: ${command}`, status: result.success ? "executed" : "failed" };
}

function rejectShell(state: AgentGraphState, feedback?: string): CockpitApprovalExecutionResult {
  const command = resolveCockpitShellCommand(state) ?? "verification command";
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
  return { state: next, message: "Shell verification rejected.", status: "rejected" };
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
  return { state: next, message: "Re-review requested.", status: "revision_requested" };
}

async function undoLatestPatch(cwd: string, state: AgentGraphState): Promise<CockpitApprovalExecutionResult> {
  if (!state.access.patchAllowed) return { state, message: accessBlockedMessage(state, "undo"), status: "blocked" };
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
  return { state: next, message: `Undo restored ${restored.restoredPath}.`, status: "undone" };
}

function selectedCandidate(state: AgentGraphState) {
  const pendingRepair = state.repairCandidates.at(-1);
  if (pendingRepair && state.agents.some((agent) => agent.status === "waiting_for_user" && agent.role === "runner")) return pendingRepair;
  const candidates = [...state.candidates, ...state.repairCandidates];
  return candidates.find((candidate) => candidate.candidateId === state.judge?.selectedCandidateId) ?? candidates[0];
}

async function runStructuralDeliverableVerifier(cwd: string, state: AgentGraphState): Promise<AgentGraphState["runResults"][number] | undefined> {
  const files = state.changedFiles.filter((file) => /\.(?:md|markdown|html?|txt|rst|adoc)$/i.test(file));
  if (!files.length) return undefined;
  const root = path.resolve(cwd);
  const checked: string[] = [];
  for (const file of files) {
    const target = path.resolve(cwd, file);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) return undefined;
    const content = await readFile(target, "utf8").catch(() => "");
    if (!content.trim()) return undefined;
    checked.push(file);
  }
  return {
    command: "structural document verifier",
    exitCode: 0,
    stdout: `Checked ${checked.length} document deliverable(s): ${checked.join(", ")}`,
    stderr: "",
    durationMs: 0,
    success: true
  };
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
      userReplySource: "blocked",
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
      userReplySource: "blocked",
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
