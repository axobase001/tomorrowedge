import type { AgentGraphState } from "../../core/agentGraph/state.js";
import { applyUnifiedDiffWithResult } from "../../core/patch/patchApplier.js";
import { runTestCommand } from "../../core/verifier/testRunner.js";
import { evidenceFromRun } from "../../core/verifier/evidenceMatcher.js";
import { SummarizerAgent } from "../../core/agents/summarizer.js";
import { restoreLatestUndoSnapshot } from "../../core/patch/undoManager.js";
import { loadConfig } from "../../config/configLoader.js";
import { finalizePostApprovalTrace } from "../../core/traces/postApprovalFinalizer.js";
import { effectiveShellPolicy } from "../../core/tools/shellPolicy.js";
import { makeId } from "../../utils/ids.js";

export type TuiActionResult = {
  graph: AgentGraphState;
  message: string;
};

export async function approveSelectedPatch(cwd: string, graph: AgentGraphState): Promise<TuiActionResult> {
  if (!graph.access.patchAllowed) {
    return { graph, message: accessBlockedMessage(graph, "patch") };
  }
  const selected = getSelectedCandidate(graph);
  if (!selected?.unifiedDiff) {
    return { graph, message: "当前没有可应用的候选补丁。" };
  }
  const applyResult = await applyUnifiedDiffWithResult(cwd, selected.unifiedDiff, true);
  const diffRef = writeArtifact(graph, "diffs", selected.unifiedDiff, "diff");
  const nextGraph = await refreshSummary({
    ...graph,
    changedFiles: [...new Set([...graph.changedFiles, ...applyResult.changedFiles])],
    approvals: { ...graph.approvals, patchApproved: true },
    agents: [
      ...graph.agents,
      {
        id: "tui_apply_patch",
        role: "runner",
        provider: "local_tool",
        model: "approval_gate",
        status: "success",
        summary: `已应用补丁：${applyResult.changedFiles.join(", ")}`
      }
    ],
    events: [
      ...graph.events,
      makeEvent(graph, {
        type: "patch_apply",
        phase: "patch",
        role: "runner",
        provider: "local_tool",
        model: "patch",
        candidateId: selected.candidateId,
        filesChanged: applyResult.changedFiles,
        diffRef,
        undoSnapshotIds: applyResult.undoSnapshotIds,
        applied: true
      })
    ]
  });
  return { graph: nextGraph, message: `补丁已应用：${applyResult.changedFiles.join(", ")}` };
}

export async function approveTestCommand(cwd: string, graph: AgentGraphState): Promise<TuiActionResult> {
  if (!graph.access.shellAllowed) {
    return { graph, message: accessBlockedMessage(graph, "shell") };
  }
  const command = graph.plan?.verificationCommands?.[0];
  if (!command) return { graph, message: "当前没有建议的测试命令。" };
  if (!graph.changedFiles.length) return { graph, message: "请先应用补丁，再运行测试。" };

  const config = loadConfig(cwd);
  const result = await runTestCommand(cwd, command, {
    approved: true,
    policy: effectiveShellPolicy(config.shell.policy),
    verificationAllowlist: config.shell.verification_allowlist
  });
  const stdoutRef = writeArtifact(graph, "stdout", result.stdout || "", "txt");
  const stderrRef = writeArtifact(graph, "stderr", result.stderr || "", "txt");
  const summarized = await refreshSummary({
    ...graph,
    runResults: [...graph.runResults, result],
    approvals: { ...graph.approvals, shellApproved: true },
    agents: [
      ...graph.agents,
      {
        id: `tui_run_${graph.runResults.length + 1}`,
        role: "runner",
        provider: "local_tool",
        model: "shell",
        status: result.success ? "success" : "failed",
        summary: `${command} 退出码 ${result.exitCode}`
      }
    ],
    events: [
      ...graph.events,
      makeEvent(graph, {
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
  const nextGraph = await finalizePostApprovalTrace(cwd, summarized, "tui");
  return { graph: nextGraph, message: result.success ? `命令通过：${command}` : `命令失败：${command}` };
}

export async function undoLatestPatch(cwd: string, graph: AgentGraphState): Promise<TuiActionResult> {
  if (!graph.access.patchAllowed) {
    return { graph, message: accessBlockedMessage(graph, "undo") };
  }
  const restored = await restoreLatestUndoSnapshot(cwd);
  const nextGraph = await refreshSummary({
    ...graph,
    changedFiles: graph.changedFiles.filter((file) => file !== restored.restoredPath),
    agents: [
      ...graph.agents,
      {
        id: "tui_undo_patch",
        role: "runner",
        provider: "local_tool",
        model: "undo",
        status: "success",
        summary: `已回滚：${restored.restoredPath}`
      }
    ]
  });
  return { graph: nextGraph, message: `已从 ${restored.snapshotId} 回滚：${restored.restoredPath}` };
}

function getSelectedCandidate(graph: AgentGraphState) {
  return graph.candidates.find((candidate) => candidate.candidateId === graph.judge?.selectedCandidateId) ?? graph.candidates[0];
}

async function refreshSummary(graph: AgentGraphState): Promise<AgentGraphState> {
  if (!graph.plan) return graph;
  const summarizer = new SummarizerAgent();
  const finalSummary = await summarizer.run({
    plan: graph.plan,
    changedFiles: graph.changedFiles,
    testsRun: graph.runResults.map((result) => result.command),
    evidence: ["offline graph completed", ...graph.runResults.map(evidenceFromRun)]
  });
  return { ...graph, finalSummary };
}

function writeArtifact(graph: AgentGraphState, kind: string, content: string, extension: string): string {
  const ref = `artifacts/${kind}/${makeId(kind)}.${extension}`;
  graph.eventArtifacts.push({ ref, content });
  return ref;
}

function makeEvent(graph: AgentGraphState, event: Record<string, unknown>): AgentGraphState["events"][number] {
  return {
    ...event,
    id: makeId(String(event.type ?? "event")),
    timestamp: new Date().toISOString(),
    sessionId: graph.sessionId,
    mode: graph.access.mode
  } as AgentGraphState["events"][number];
}

function accessBlockedMessage(graph: AgentGraphState, action: "patch" | "shell" | "undo"): string {
  const label = action === "patch" ? "应用补丁" : action === "shell" ? "运行命令" : "回滚补丁";
  return `当前 ${graph.access.mode} 访问模式不允许${label}。`;
}
