import { loadConfig } from "../../config/configLoader.js";
import { runOfflineGraph } from "../../core/agentGraph/executor.js";
import { loadLatestSession, loadSession } from "../../core/memory/sessionMemory.js";
import { renderCockpit } from "../renderCockpit.js";

export async function tuiCommand(cwd: string, goal = "Open TomorrowEdge cockpit", options: { to?: string; session?: string } = {}): Promise<void> {
  const config = loadConfig(cwd);
  if (options.session) {
    const session = options.session === "latest" ? await loadLatestSession(cwd) : await loadSession(cwd, options.session);
    await renderCockpit(session.state, config.project.safe_mode, cwd);
    return;
  }
  const state = await runOfflineGraph(cwd, goal, config, { conversationTarget: options.to });
  await renderCockpit(state, config.project.safe_mode, cwd);
}
