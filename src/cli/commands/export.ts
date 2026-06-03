import { loadLatestSession, loadSession } from "../../core/memory/sessionMemory.js";
import { renderEventMarkdown } from "../../core/events/eventRenderer.js";

export type ExportOptions = {
  format?: "markdown" | "json";
};

export async function exportCommand(cwd: string, sessionId: string, options: ExportOptions = {}): Promise<void> {
  const initial = sessionId === "latest" ? await loadLatestSession(cwd) : await loadSession(cwd, sessionId);
  const session = await loadSession(cwd, initial.sessionId);
  if (options.format === "json") {
    process.stdout.write(JSON.stringify(session, null, 2) + "\n");
    return;
  }
  const state = session.state;
  process.stdout.write(`# TomorrowEdge Session ${session.sessionId}

Created: ${session.createdAt}

## Goal

${state.goal}

## Access

- Mode: ${state.access.mode}
- Cloud allowed: ${state.access.cloudAllowed}
- Patch approved: ${state.access.patchApproved}
- Shell approved: ${state.access.shellApproved}
- Repair approved: ${state.access.repairApproved}

## Routing

${state.routing.assignments.map((item) => `- ${item.role}: ${item.provider}/${item.model} (${item.reason})`).join("\n")}

## Events

${renderEventMarkdown(state.events)}

## Patches

${state.candidates.map((candidate) => `- ${candidate.candidateId}: ${candidate.summary} [${candidate.filesChanged.join(", ") || "no files"}]`).join("\n") || "No patch candidates."}

## Shell Commands

${state.runResults.map((result) => `- ${result.command}: exit=${result.exitCode}, success=${result.success}`).join("\n") || "No shell commands executed."}

## Evidence

${state.finalSummary?.evidence.map((item) => `- ${item}`).join("\n") ?? "No final evidence."}

## Final Summary

${state.finalSummary ? `${state.finalSummary.result}: ${state.finalSummary.suggestedCommitMessage}` : "No final summary."}
`);
}
