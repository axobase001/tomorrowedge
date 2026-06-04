import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadLatestSession, loadSession } from "../../core/memory/sessionMemory.js";
import { artifactRefs, renderEventMarkdown } from "../../core/events/eventRenderer.js";
import type { TomorrowEdgeEvent } from "../../core/events/eventTypes.js";

export type ExportOptions = {
  format?: "markdown" | "json";
  includeArtifacts?: boolean;
  brief?: boolean;
};

export async function exportCommand(cwd: string, sessionId: string, options: ExportOptions = {}): Promise<void> {
  const initial = sessionId === "latest" ? await loadLatestSession(cwd) : await loadSession(cwd, sessionId);
  const session = await loadSession(cwd, initial.sessionId);
  const sessionDir = resolveSessionDir(cwd, session.sessionId);
  const artifacts = await loadArtifacts(session.state.events, sessionDir);

  if (options.format === "json") {
    process.stdout.write(JSON.stringify(options.includeArtifacts ? { ...session, artifacts } : session, null, 2) + "\n");
    return;
  }

  const state = session.state;
  if (options.brief) {
    process.stdout.write(renderBriefExport(session.sessionId, session.createdAt, state));
    return;
  }

  process.stdout.write(`# TomorrowEdge Session ${session.sessionId}

Created: ${session.createdAt}

## Goal

${state.goal}

## Conversation Target

${state.conversationTarget ? `- Target: ${state.conversationTarget.id}
- Label: ${state.conversationTarget.label}
- Kind: ${state.conversationTarget.kind}
- Description: ${state.conversationTarget.description}` : "- Target: core"}

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

## Artifact Details

${renderArtifactDetails(state.events, artifacts)}

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

function resolveSessionDir(cwd: string, sessionId: string): string {
  const dir = path.join(cwd, ".tomorrowedge", "sessions", sessionId);
  return existsSync(dir) ? dir : path.join(cwd, ".tomorrowedge", "sessions");
}

async function loadArtifacts(events: TomorrowEdgeEvent[], sessionDir: string): Promise<Record<string, string>> {
  const refs = [...new Set(events.flatMap(artifactRefs))];
  const entries = await Promise.all(
    refs.map(async (ref) => {
      const content = await readFile(path.join(sessionDir, ref), "utf8").catch(() => "");
      return [ref, content] as const;
    })
  );
  return Object.fromEntries(entries.filter(([, content]) => content.length));
}

function renderArtifactDetails(events: TomorrowEdgeEvent[], artifacts: Record<string, string>): string {
  const sections: string[] = [];
  for (const event of events) {
    for (const ref of artifactRefs(event)) {
      const content = artifacts[ref];
      if (!content) continue;
      sections.push(`### ${event.type} ${ref}\n\n\`\`\`${fenceLanguage(ref)}\n${content.trimEnd()}\n\`\`\``);
    }
  }
  return sections.join("\n\n") || "No artifact refs recorded.";
}

function fenceLanguage(ref: string): string {
  if (ref.includes("/diffs/")) return "diff";
  if (ref.endsWith(".json")) return "json";
  return "text";
}

function renderBriefExport(sessionId: string, createdAt: string, state: Awaited<ReturnType<typeof loadSession>>["state"]): string {
  const eventCount = state.events?.length ?? 0;
  const patchCount = state.candidates.filter((candidate) => candidate.unifiedDiff.trim()).length;
  const shellCount = state.runResults.length;
  const artifactCount = new Set(state.events.flatMap(artifactRefs)).size;
  return [
    `TomorrowEdge Session ${sessionId}`,
    `Created: ${createdAt}`,
    `Goal: ${state.goal}`,
    `Conversation target: ${state.conversationTarget ? `${state.conversationTarget.id} (${state.conversationTarget.label})` : "core"}`,
    `Access: ${state.access.mode}`,
    `Events: ${eventCount}`,
    `Artifacts: ${artifactCount}`,
    `Patch candidates: ${patchCount}`,
    `Shell runs: ${shellCount}`,
    `Result: ${state.finalSummary?.result ?? "unknown"}`,
    "",
    "Use tedge export latest --format markdown for the full artifact-expanded report.",
    "Use tedge trace latest --verbose for event refs."
  ].join("\n") + "\n";
}
