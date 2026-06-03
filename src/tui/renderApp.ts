import React from "react";
import type { AgentGraphState } from "../core/agentGraph/state.js";
import { App } from "./App.js";

export type RenderAppOptions = {
  graph: AgentGraphState;
  safeMode: boolean;
  cwd: string;
  commandName: string;
};

export async function renderInteractiveApp(options: RenderAppOptions): Promise<void> {
  if (!isInteractiveTerminal()) {
    process.stderr.write(`${options.commandName} requires an interactive terminal with raw-mode stdin. Use a headless command when running in CI or redirected shells.\n`);
    process.exitCode = 1;
    return;
  }

  const { render } = await import("ink");
  render(React.createElement(App, { graph: options.graph, safeMode: options.safeMode, cwd: options.cwd }));
}

export function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}
