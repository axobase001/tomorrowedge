import { loadConfig } from "../../config/configLoader.js";
import { runOfflineGraph } from "../../core/agentGraph/executor.js";
import { renderInteractiveApp } from "../../tui/renderApp.js";

export async function tuiCommand(cwd: string, goal = "打开 TomorrowEdge 驾驶舱"): Promise<void> {
  const config = loadConfig(cwd);
  const state = await runOfflineGraph(cwd, goal, config);
  await renderInteractiveApp({ graph: state, safeMode: config.project.safe_mode, cwd, commandName: "tedge tui" });
}
