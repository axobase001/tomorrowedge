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

export function App({ graph, safeMode = true, cwd = process.cwd() }: { graph: AgentGraphState; safeMode?: boolean; cwd?: string }) {
  const { exit } = useApp();
  const [viewGraph, setViewGraph] = useState(graph);
  const [message, setMessage] = useState("就绪。按 a 应用补丁，按 t 运行测试，按 c 打开命令面板，按 q 退出。");
  const [busy, setBusy] = useState(false);
  const [palette, setPalette] = useState<PaletteMode | null>(null);

  useInput((input, key) => {
    if (palette && (key.escape || key.return)) {
      setPalette(null);
      return;
    }
    if (input === "q") exit();
    if (busy) return;
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

  return (
    <Box flexDirection="column">
      <Text bold>TomorrowEdge / 明日边缘</Text>
      <Text color="gray">多模型 coding agent 终端驾驶舱。强模型计划与裁决，高性价比模型探索与实现。</Text>
      <Text color={busy ? "yellow" : "cyan"}>{busy ? "执行中..." : message}</Text>
      <ApprovalPrompt safeMode={safeMode} />
      {palette ? <CommandPalette mode={palette} graph={viewGraph} /> : null}
      <Box gap={1}>
        <AgentsPane agents={viewGraph.agents} />
        <Box flexDirection="column" width="50%">
          <GoalPane goal={viewGraph.goal} plan={viewGraph.plan} />
          <RouterPane routing={viewGraph.routing} access={viewGraph.access} />
        </Box>
      </Box>
      <Box gap={1}>
        <Box flexDirection="column" width="50%">
          <DebatePane candidates={viewGraph.candidates} review={viewGraph.review} judge={viewGraph.judge} rounds={viewGraph.debateRounds} />
          <EvidencePane summary={viewGraph.finalSummary} />
        </Box>
        <Box flexDirection="column" width="50%">
          <DiffPane candidate={viewGraph.candidates.find((candidate) => candidate.candidateId === viewGraph.judge?.selectedCandidateId) ?? viewGraph.candidates[0]} />
          <ShellPane commands={viewGraph.plan?.verificationCommands ?? []} />
        </Box>
      </Box>
      <Box gap={1}>
        <Box width="50%">
          <MemoryPane graph={viewGraph} />
        </Box>
        <Box width="50%">
          <HelpPane />
        </Box>
      </Box>
    </Box>
  );
}
