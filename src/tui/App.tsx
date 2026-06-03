import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { AgentGraphState } from "../core/agentGraph/state.js";
import { approveSelectedPatch, approveTestCommand, undoLatestPatch } from "./state/approvalActions.js";
import { ApprovalPrompt } from "./components/ApprovalPrompt.js";
import { CommandPalette, type PaletteMode } from "./components/CommandPalette.js";
import { AgentsPane } from "./panes/AgentsPane.js";
import { DebatePane } from "./panes/DebatePane.js";
import { DiffPane } from "./panes/DiffPane.js";
import { EvidencePane } from "./panes/EvidencePane.js";
import { GoalPane } from "./panes/GoalPane.js";
import { HelpPane } from "./panes/HelpPane.js";
import { MemoryPane } from "./panes/MemoryPane.js";
import { RouterPane } from "./panes/RouterPane.js";
import { ShellPane } from "./panes/ShellPane.js";
import { TracePane } from "./panes/TracePane.js";

const focusPanes = ["agents", "goal", "routing", "trace", "debate", "evidence", "diff", "shell", "memory", "help"] as const;
type FocusPane = (typeof focusPanes)[number];

export function App({ graph, safeMode = true, cwd = process.cwd() }: { graph: AgentGraphState; safeMode?: boolean; cwd?: string }) {
  const { exit } = useApp();
  const [viewGraph, setViewGraph] = useState(graph);
  const [message, setMessage] = useState(initialMessage(graph.access.mode));
  const [busy, setBusy] = useState(false);
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);

  useInput((input, key) => {
    if (palette && (key.escape || key.return)) {
      setPalette(null);
      return;
    }
    if (key.tab || input === "\t") {
      setFocusIndex((index) => (index + 1) % focusPanes.length);
      return;
    }
    if (input === "q") exit();
    if (busy) return;
    if (palette === "models" && /^[1-9]$/.test(input)) {
      const index = Number(input) - 1;
      if (index < viewGraph.routing.assignments.length) setSelectedRouteIndex(index);
      return;
    }
    if (palette === "models" && (input === "+" || input === "-")) {
      setViewGraph((current) => previewRouteAssignment(current, selectedRouteIndex, input === "+" ? 1 : -1));
      return;
    }
    if (input === "c") {
      setPalette(palette === "commands" ? null : "commands");
      return;
    }
    if (input === "p") {
      setPalette(palette === "access" ? null : "access");
      return;
    }
    if (input === "m") {
      setPalette(palette === "models" ? null : "models");
      return;
    }
    if (input === "a") {
      setBusy(true);
      approveSelectedPatch(cwd, viewGraph)
        .then((result) => {
          setViewGraph(result.graph);
          setMessage(result.message);
        })
        .catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)))
        .finally(() => setBusy(false));
    }
    if (input === "t") {
      setBusy(true);
      approveTestCommand(cwd, viewGraph)
        .then((result) => {
          setViewGraph(result.graph);
          setMessage(result.message);
        })
        .catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)))
        .finally(() => setBusy(false));
    }
    if (input === "u") {
      setBusy(true);
      undoLatestPatch(cwd, viewGraph)
        .then((result) => {
          setViewGraph(result.graph);
          setMessage(result.message);
        })
        .catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)))
        .finally(() => setBusy(false));
    }
  });

  const activePane = focusPanes[focusIndex] as FocusPane;

  return (
    <Box flexDirection="column">
      <Text bold>TomorrowEdge / 明日边缘</Text>
      <Text color="gray">TUI-first multi-model agent cockpit for full-access coding workflows.</Text>
      <Text color={viewGraph.access.mode === "full" ? "green" : viewGraph.access.mode === "restricted" ? "yellow" : "cyan"}>{modeBanner(viewGraph.access.mode)}</Text>
      <Text color={busy ? "yellow" : "cyan"}>{busy ? "Working..." : message}</Text>
      <Text color="gray">Focus: {activePane}</Text>
      {viewGraph.access.mode === "partial" ? <ApprovalPrompt safeMode={safeMode} /> : null}
      {palette ? <CommandPalette mode={palette} graph={viewGraph} selectedRouteIndex={selectedRouteIndex} /> : null}
      <Box gap={1}>
        <AgentsPane agents={viewGraph.agents} active={activePane === "agents"} />
        <Box flexDirection="column" width="50%">
          <GoalPane goal={viewGraph.goal} plan={viewGraph.plan} active={activePane === "goal"} />
          <RouterPane routing={viewGraph.routing} access={viewGraph.access} capabilityRoute={viewGraph.capabilityRoute} active={activePane === "routing"} />
        </Box>
      </Box>
      <Box gap={1}>
        <Box flexDirection="column" width="50%">
          <DebatePane candidates={viewGraph.candidates} review={viewGraph.review} judge={viewGraph.judge} rounds={viewGraph.debateRounds} active={activePane === "debate"} />
          <EvidencePane summary={viewGraph.finalSummary} active={activePane === "evidence"} />
        </Box>
        <Box flexDirection="column" width="50%">
          <DiffPane candidate={viewGraph.candidates.find((candidate) => candidate.candidateId === viewGraph.judge?.selectedCandidateId) ?? viewGraph.candidates[0]} active={activePane === "diff"} />
          <ShellPane commands={viewGraph.plan?.verificationCommands ?? []} active={activePane === "shell"} />
        </Box>
      </Box>
      <Box gap={1}>
        <Box width="50%">
          <TracePane events={viewGraph.events ?? []} active={activePane === "trace"} />
        </Box>
        <Box width="50%">
          <MemoryPane graph={viewGraph} active={activePane === "memory"} />
        </Box>
      </Box>
      <Box gap={1}>
        <Box width="50%">
          <HelpPane active={activePane === "help"} />
        </Box>
      </Box>
    </Box>
  );
}

function initialMessage(mode: AgentGraphState["access"]["mode"]): string {
  if (mode === "full") return "FULL AUTONOMY: patch, shell, and repair actions run automatically; every step is logged.";
  if (mode === "restricted") return "RESTRICTED: offline/read-only trace inspection.";
  return "PARTIAL SUPERVISION: press a/t/u for explicit patch, shell, and undo actions.";
}

function modeBanner(mode: AgentGraphState["access"]["mode"]): string {
  if (mode === "full") return "MODE: FULL AUTONOMY / full access cockpit";
  if (mode === "restricted") return "MODE: RESTRICTED / offline read-only";
  return "MODE: PARTIAL SUPERVISION / approval prompts enabled";
}

function previewRouteAssignment(graph: AgentGraphState, index: number, direction: 1 | -1): AgentGraphState {
  const choices = [
    { provider: "mock", model: "mock-balanced" },
    { provider: "openrouter", model: "openai/gpt-5.2" },
    { provider: "deepseek", model: "deepseek-v4-pro" },
    { provider: "mimo", model: "mimo-v2.5-pro" },
    { provider: "ollama", model: "local-auto" }
  ];
  const assignments = graph.routing.assignments.map((assignment, assignmentIndex) => {
    if (assignmentIndex !== index || assignment.provider === "local_tool") return assignment;
    const current = choices.findIndex((choice) => choice.provider === assignment.provider && choice.model === assignment.model);
    const next = choices[(current + direction + choices.length) % choices.length] ?? choices[0];
    return { ...assignment, ...next, reason: "TUI preview override; persist with tedge prefs/config." };
  });
  return { ...graph, routing: { ...graph.routing, assignments } };
}
