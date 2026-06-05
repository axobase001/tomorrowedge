import React, { useMemo, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { AccessMode } from "../config/schema.js";
import { loadConfig } from "../config/configLoader.js";
import { runOfflineGraph } from "../core/agentGraph/executor.js";
import type { AgentGraphState } from "../core/agentGraph/state.js";
import { createConversationSession } from "../core/conversation/conversationSession.js";
import { listConversationTargets, renderConversationTarget } from "../core/conversation/conversationTargets.js";
import { renderEventLine } from "../core/events/eventRenderer.js";
import { saveSession } from "../core/memory/sessionMemory.js";
import { buildAccessPolicy } from "../core/permissions/accessPolicy.js";
import type { ConversationTarget } from "../schemas/conversation.js";
import { approveSelectedPatch, approveTestCommand, undoLatestPatch } from "./state/approvalActions.js";
import { ApprovalPrompt } from "./components/ApprovalPrompt.js";
import { CommandPalette, type PaletteMode } from "./components/CommandPalette.js";

const focusPanes = ["memory", "agents", "goal", "routing", "trace", "debate", "evidence", "diff", "shell", "help"] as const;
type FocusPane = (typeof focusPanes)[number];

export function App({ graph, safeMode = true, cwd = process.cwd() }: { graph: AgentGraphState; safeMode?: boolean; cwd?: string }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const config = useMemo(() => loadConfig(cwd), [cwd]);
  const targets = useMemo(() => listConversationTargets(config), [config]);
  const initialTargetIndex = Math.max(0, targets.findIndex((target) => target.id === (graph.conversationTarget?.id ?? "core")));
  const [viewGraph, setViewGraph] = useState(graph);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState(initialMessage(graph.access.mode));
  const [busy, setBusy] = useState(false);
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [targetIndex, setTargetIndex] = useState(initialTargetIndex);
  const [accessMode, setAccessMode] = useState<AccessMode>(graph.access.mode);
  const activeTarget = targets[targetIndex] ?? targets[0] ?? graph.conversationTarget;
  const compactViewport = (stdout.rows ?? 24) < 28 || (stdout.columns ?? 100) < 112;

  useInput((input, key) => {
    if (palette && (key.escape || key.return)) {
      setPalette(null);
      return;
    }
    if (palette === "models" && /^[1-9]$/.test(input)) {
      const index = Number(input) - 1;
      if (index < viewGraph.routing.assignments.length) setSelectedRouteIndex(index);
      return;
    }
    if (palette === "models" && (input === "+" || input === "-")) {
      setViewGraph((current) => previewRouteAssignment(current, selectedRouteIndex, input === "+" ? 1 : -1));
      return;
    }
    if (key.tab || input === "\t") {
      setFocusIndex((index) => (index + 1) % focusPanes.length);
      return;
    }
    if (key.escape) {
      if (draft) setDraft("");
      else setMessage("Composer cleared. Use Ctrl+Q to quit.");
      return;
    }
    if (key.ctrl && input.toLowerCase() === "q") {
      exit();
      return;
    }
    if (key.ctrl && input.toLowerCase() === "t") {
      setTargetIndex((index) => (index + 1) % Math.max(1, targets.length));
      return;
    }
    if (busy) return;
    if (key.ctrl && input.toLowerCase() === "p") {
      setPalette(palette === "access" ? null : "access");
      return;
    }
    if (key.ctrl && input.toLowerCase() === "m") {
      setPalette(palette === "models" ? null : "models");
      return;
    }
    if (key.ctrl && input.toLowerCase() === "a") {
      runTuiAction("patch", cwd, viewGraph, setBusy, setMessage, setViewGraph);
      return;
    }
    if (key.ctrl && input.toLowerCase() === "r") {
      runTuiAction("test", cwd, viewGraph, setBusy, setMessage, setViewGraph);
      return;
    }
    if (key.ctrl && input.toLowerCase() === "u") {
      runTuiAction("undo", cwd, viewGraph, setBusy, setMessage, setViewGraph);
      return;
    }
    if (isNewline(input, key)) {
      setDraft((current) => `${current}\n`);
      return;
    }
    if (key.return) {
      void submitComposer({
        draft,
        target: activeTarget,
        accessMode,
        cwd,
        config,
        setAccessMode,
        setBusy,
        setDraft,
        setMessage,
        setViewGraph
      });
      return;
    }
    if (key.backspace || key.delete) {
      setDraft((current) => current.slice(0, -1));
      return;
    }
    if (isPrintableInput(input, key)) {
      setDraft((current) => `${current}${input}`);
    }
  });

  const activePane = focusPanes[focusIndex] as FocusPane;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Header graph={viewGraph} safeMode={safeMode} busy={busy} />
      {viewGraph.access.mode === "partial" ? <ApprovalPrompt graph={viewGraph} /> : null}
      {palette ? <CommandPalette mode={palette} graph={viewGraph} selectedRouteIndex={selectedRouteIndex} /> : null}
      <StatusStrip graph={viewGraph} />
      <CockpitGrid graph={viewGraph} activePane={activePane} compact={compactViewport} />
      <OperatorConsole draft={draft} target={activeTarget} accessMode={accessMode} message={busy ? "Working..." : message} />
      <Footer graph={viewGraph} activePane={activePane} compact={compactViewport} />
    </Box>
  );
}

function Header({ graph, safeMode, busy }: { graph: AgentGraphState; safeMode: boolean; busy: boolean }) {
  return (
    <Box flexDirection="column" paddingY={1}>
      <Box justifyContent="space-between">
        <Text bold>TomorrowEdge / 明日边缘</Text>
        <Text color={graph.access.mode === "full" ? "green" : graph.access.mode === "restricted" ? "yellow" : "cyan"}>
          {modeBanner(graph.access.mode)} {busy ? "RUNNING" : safeMode ? "SAFE" : "LIVE"}
        </Text>
      </Box>
      <Text color="gray">TUI runtime cockpit · visible routing · explicit authorization · replayable trace</Text>
    </Box>
  );
}

function StatusStrip({ graph }: { graph: AgentGraphState }) {
  const route = graph.routing.assignments
    .filter((assignment) => ["planner", "coder_a", "reviewer", "judge"].includes(assignment.role))
    .map((assignment) => assignment.provider.replace(/^external:/, "ext:"))
    .join(" / ");
  return (
    <Box gap={1}>
      <Metric label="TASK" value={clip(graph.goal, 28)} />
      <Metric label="BACKEND" value="native" />
      <Metric label="PROVIDER ROUTE" value={clip(route || "mock / fixture", 34)} />
      <Metric label="EVENTS" value={String(graph.events.length)} />
    </Box>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} width="25%">
      <Text color="gray">{label}</Text>
      <Text bold>{value}</Text>
    </Box>
  );
}

function CockpitGrid({ graph, activePane, compact }: { graph: AgentGraphState; activePane: FocusPane; compact: boolean }) {
  if (compact) {
    return (
      <Box flexDirection="column">
        <AgentsPanel graph={graph} active={activePane === "agents"} />
        <PatchPanel graph={graph} active={activePane === "diff"} />
        <JudgePanel graph={graph} active={activePane === "trace" || activePane === "shell"} />
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Box width="50%">
          <AgentsPanel graph={graph} active={activePane === "agents"} />
        </Box>
        <Box width="50%">
          <CapabilityPanel graph={graph} active={activePane === "routing"} />
        </Box>
      </Box>
      <Box gap={1}>
        <Box width="50%">
          <PatchPanel graph={graph} active={activePane === "diff"} />
        </Box>
        <Box width="50%">
          <JudgePanel graph={graph} active={activePane === "trace" || activePane === "shell"} />
        </Box>
      </Box>
    </Box>
  );
}

function AgentsPanel({ graph, active }: { graph: AgentGraphState; active: boolean }) {
  const rows = graph.agents.length ? graph.agents.slice(0, 9) : graph.routing.assignments.slice(0, 9).map((assignment) => ({
    id: assignment.role,
    role: assignment.role,
    provider: assignment.provider,
    model: assignment.model,
    status: "pending" as const,
    summary: assignment.reason
  }));
  return (
    <Panel title="Agents" active={active}>
      {rows.map((agent) => (
        <Box key={`${agent.id}-${agent.role}`} justifyContent="space-between">
          <Text><Text color="cyan">{pad(agent.role, 10)}</Text> {clip(`${agent.provider}/${agent.model}`, 32)}</Text>
          <Text color={agent.status === "success" ? "green" : agent.status === "failed" ? "red" : agent.status === "waiting_for_user" ? "yellow" : "gray"}>{agent.status}</Text>
        </Box>
      ))}
    </Panel>
  );
}

function CapabilityPanel({ graph, active }: { graph: AgentGraphState; active: boolean }) {
  const assignments = graph.routing.assignments.filter((assignment) => ["planner", "explorer", "coder_a", "reviewer", "judge", "runner"].includes(assignment.role));
  return (
    <Panel title="Capability Route" active={active}>
      {assignments.slice(0, 8).map((assignment) => (
        <Box key={assignment.role} justifyContent="space-between">
          <Text><Text color="cyan">{pad(labelRole(assignment.role), 10)}</Text> {clip(`${assignment.provider}/${assignment.model}`, 36)}</Text>
          <Text color="green">ok</Text>
        </Box>
      ))}
      {graph.capabilityRoute ? <Text color="gray">stitching: {graph.capabilityRoute.inputTypes.join(", ")} -&gt; code</Text> : null}
    </Panel>
  );
}

function PatchPanel({ graph, active }: { graph: AgentGraphState; active: boolean }) {
  const selected = graph.candidates.find((candidate) => candidate.candidateId === graph.judge?.selectedCandidateId) ?? graph.candidates[0] ?? graph.repairCandidates[0];
  const diffLines = selected?.unifiedDiff.split(/\r?\n/).filter(Boolean).slice(0, 10) ?? [];
  return (
    <Panel title="Patch Candidate" active={active}>
      {selected ? (
        <>
          <Box justifyContent="space-between">
            <Text><Text color="cyan">diff</Text> {clip(selected.filesChanged.join(", ") || selected.candidateId, 42)}</Text>
            <Text color={selected.estimatedRisk === "low" ? "green" : "yellow"}>{selected.estimatedRisk}</Text>
          </Box>
          {diffLines.map((line, index) => <Text key={`${index}-${line}`} color={line.startsWith("+") ? "green" : line.startsWith("-") ? "red" : "gray"}>{clip(line, 72)}</Text>)}
        </>
      ) : (
        <Text color="gray">No patch candidate yet. Type a task in Command / 对话.</Text>
      )}
    </Panel>
  );
}

function JudgePanel({ graph, active }: { graph: AgentGraphState; active: boolean }) {
  const latestEvents = graph.events.slice(-5);
  const shell = graph.runResults.at(-1);
  return (
    <Panel title="Judge / Review" active={active}>
      {graph.review ? <Text><Text color="cyan">review</Text> {clip(graph.review.overallRecommendation, 58)}</Text> : <Text color="gray">review pending</Text>}
      {graph.judge ? <Text><Text color="cyan">judge</Text> selected {graph.judge.selectedCandidateId}</Text> : <Text color="gray">judge pending</Text>}
      {shell ? <Text><Text color="cyan">shell</Text> {shell.command} <Text color={shell.exitCode === 0 ? "green" : "yellow"}>{shell.exitCode === 0 ? "passed" : "failed"}</Text></Text> : null}
      {latestEvents.map((event) => (
        <Text key={event.id} color="gray">{clip(renderEventLine(event), 76)}</Text>
      ))}
    </Panel>
  );
}

function Panel({ title, active, children }: { title: string; active: boolean; children: React.ReactNode }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={active ? "cyan" : "gray"} paddingX={1} minHeight={7}>
      <Text bold>{title}</Text>
      {children}
    </Box>
  );
}

function OperatorConsole({ draft, target, accessMode, message }: { draft: string; target?: ConversationTarget; accessMode: AccessMode; message: string }) {
  const lines = draft.split("\n");
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold>Command / Talk</Text>
        <Text color="gray">to {target ? renderConversationTarget(target) : "core"} | {accessMode}</Text>
      </Box>
      {draft ? lines.slice(-2).map((line, index) => <Text key={`${index}-${line}`}>{index === 0 ? "&gt; " : "  "}{clip(line, 120)}</Text>) : <Text color="gray">&gt; Type a task, or use /run /ask /to reviewer /mode full</Text>}
      <Box justifyContent="space-between">
        <Text color="cyan">{clip(message, 92)}</Text>
        <Text color="gray">Enter run | Ctrl+T target | Tab focus | Ctrl+Q quit</Text>
      </Box>
    </Box>
  );
}

function Footer({ graph, activePane, compact = false }: { graph: AgentGraphState; activePane: FocusPane; compact?: boolean }) {
  const traceScore = graph.traceCompleteness ? `${graph.traceCompleteness.score}/100` : "n/a";
  return (
    <Text color="gray">
      focus {activePane} | events {graph.events.length} | trace {traceScore}{compact ? ` | ${graph.access.mode}/${graph.routing.mode} | tokens ${graph.usageSummary.totalTokens}` : " | Ctrl+M models | Ctrl+P access | Ctrl+A patch | Ctrl+R test | Ctrl+U undo"}
    </Text>
  );
}

type TuiAction = "patch" | "test" | "undo";

function runTuiAction(
  action: TuiAction,
  cwd: string,
  graph: AgentGraphState,
  setBusy: (busy: boolean) => void,
  setMessage: (message: string) => void,
  setViewGraph: React.Dispatch<React.SetStateAction<AgentGraphState>>
) {
  setBusy(true);
  const runner = action === "patch" ? approveSelectedPatch : action === "test" ? approveTestCommand : undoLatestPatch;
  runner(cwd, graph)
    .then((result) => {
      setViewGraph(result.graph);
      setMessage(result.message);
    })
    .catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)))
    .finally(() => setBusy(false));
}

type SubmitComposerArgs = {
  draft: string;
  target?: ConversationTarget;
  accessMode: AccessMode;
  cwd: string;
  config: ReturnType<typeof loadConfig>;
  setAccessMode: (mode: AccessMode) => void;
  setBusy: (busy: boolean) => void;
  setDraft: (draft: string) => void;
  setMessage: (message: string) => void;
  setViewGraph: React.Dispatch<React.SetStateAction<AgentGraphState>>;
};

async function submitComposer(args: SubmitComposerArgs): Promise<void> {
  const text = args.draft.trim();
  if (!text) return;
  args.setBusy(true);
  try {
    const command = parseComposerCommand(text, args.target?.id ?? "core", args.accessMode);
    if (command.kind === "mode") {
      args.setDraft("");
      const access = buildAccessPolicy(args.config, { mode: command.mode });
      args.setAccessMode(command.mode);
      args.setViewGraph((current) => ({ ...current, access, approvals: { patchApproved: access.patchApproved, shellApproved: access.shellApproved, repairApproved: access.repairApproved } }));
      args.setMessage(`Mode switched to ${command.mode}.`);
      return;
    }
    if (command.kind === "palette") {
      args.setDraft("");
      args.setMessage("Commands: natural text runs a workflow. Use /ask for non-mutating notes, /to reviewer ..., /mode full.");
      return;
    }
    const state = command.kind === "ask"
      ? createConversationSession({ message: command.goal, target: command.target, config: args.config })
      : await runOfflineGraph(args.cwd, command.goal, args.config, { conversationTarget: command.target, accessMode: args.accessMode });
    args.setDraft("");
    await saveSession(args.cwd, state);
    args.setViewGraph(state);
    args.setMessage(command.kind === "ask" ? "Recorded non-mutating directed conversation." : `Workflow completed: ${state.finalSummary?.result ?? "unknown"}.`);
  } catch (error: unknown) {
    args.setMessage(error instanceof Error ? error.message : String(error));
  } finally {
    args.setBusy(false);
  }
}

type ParsedComposerCommand =
  | { kind: "run"; goal: string; target: string }
  | { kind: "ask"; goal: string; target: string }
  | { kind: "mode"; mode: AccessMode }
  | { kind: "palette" };

function parseComposerCommand(text: string, defaultTarget: string, currentMode: AccessMode): ParsedComposerCommand {
  if (text.startsWith("/mode")) {
    const mode = text.split(/\s+/)[1] as AccessMode | undefined;
    if (mode !== "restricted" && mode !== "partial" && mode !== "full") throw new Error("Usage: /mode restricted|partial|full");
    return { kind: "mode", mode };
  }
  if (text === "/commands" || text === "/help") return { kind: "palette" };
  if (text.startsWith("/ask ")) {
    return { kind: "ask", goal: text.slice("/ask ".length).trim(), target: defaultTarget };
  }
  if (text.startsWith("/run ")) {
    return { kind: "run", goal: text.slice("/run ".length).trim(), target: defaultTarget };
  }
  if (text.startsWith("/to ")) {
    const [, target, ...rest] = text.split(/\s+/);
    const goal = rest.join(" ").trim();
    if (!target || !goal) throw new Error("Usage: /to reviewer explain this patch risk");
    return { kind: currentMode === "restricted" ? "ask" : "run", goal, target };
  }
  return { kind: "run", goal: text, target: defaultTarget };
}

function initialMessage(mode: AccessMode): string {
  if (mode === "full") return "FULL AUTONOMY: patch, shell, and repair actions run automatically; every step is logged.";
  if (mode === "restricted") return "RESTRICTED: offline/read-only trace inspection.";
  return "PARTIAL SUPERVISION: patch, shell, and repair require explicit approval.";
}

function modeBanner(mode: AccessMode): string {
  if (mode === "full") return "FULL AUTONOMY";
  if (mode === "restricted") return "RESTRICTED";
  return "PARTIAL";
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

function isPrintableInput(input: string, key: { ctrl?: boolean; meta?: boolean }): boolean {
  return Boolean(input) && !key.ctrl && !key.meta && input >= " " && input !== "\u007f";
}

function isNewline(input: string, key: { ctrl?: boolean; return?: boolean; shift?: boolean; meta?: boolean }): boolean {
  return (key.ctrl && input.toLowerCase() === "j") || Boolean(key.return && (key.shift || key.meta));
}

function clip(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, Math.max(0, maxChars - 3))}...` : value;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`;
}

function labelRole(value: string): string {
  if (value === "coder_a") return "Coder";
  if (value === "coder_b") return "Coder-B";
  return value.charAt(0).toUpperCase() + value.slice(1);
}
