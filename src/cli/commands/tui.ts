import { loadConfig } from "../../config/configLoader.js";
import { runOfflineGraph } from "../../core/agentGraph/executor.js";

export async function tuiCommand(cwd: string, goal = "打开 TomorrowEdge 驾驶舱"): Promise<void> {
  const config = loadConfig(cwd);
  const state = await runOfflineGraph(cwd, goal, config);
  const { render } = await import("ink");
  const React = await import("react");
  const { App } = await import("../../tui/App.js");
  render(React.createElement(App, { graph: state, safeMode: config.project.safe_mode, cwd }));
}
