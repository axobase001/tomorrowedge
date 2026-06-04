import { loadConfig } from "../../config/configLoader.js";
import { runOfflineGraph } from "../../core/agentGraph/executor.js";
import { renderCockpit } from "../renderCockpit.js";

export async function tuiCommand(cwd: string, goal = "Open TomorrowEdge cockpit", options: { to?: string } = {}): Promise<void> {
  const config = loadConfig(cwd);
  const state = await runOfflineGraph(cwd, goal, config, { conversationTarget: options.to });
  await renderCockpit(state, config.project.safe_mode, cwd);
}
