import { loadConfig } from "../../config/configLoader.js";
import { createConversationSession } from "../../core/conversation/conversationSession.js";
import { listConversationTargets, renderConversationTarget } from "../../core/conversation/conversationTargets.js";
import { saveSession } from "../../core/memory/sessionMemory.js";

export async function targetsCommand(cwd: string): Promise<void> {
  const config = loadConfig(cwd);
  const targets = listConversationTargets(config);
  process.stdout.write("Conversation targets:\n");
  for (const target of targets) {
    process.stdout.write(`- ${target.id.padEnd(16)} ${target.label} :: ${target.description}\n`);
  }
  process.stdout.write("\nExamples:\n");
  process.stdout.write("  tedge ask --to reviewer \"is this patch safe?\"\n");
  process.stdout.write("  tedge run --to debate \"implement the feature after debate\" --live --live-patch\n");
}

export async function askCommand(cwd: string, message: string, options: { to?: string; headless?: boolean } = {}): Promise<void> {
  const config = loadConfig(cwd);
  const state = createConversationSession({ message, target: options.to, config });
  const sessionPath = await saveSession(cwd, state);
  if (options.headless) {
    process.stdout.write(JSON.stringify({ sessionPath, conversationTarget: state.conversationTarget, summary: state.finalSummary }, null, 2) + "\n");
    return;
  }
  process.stdout.write(`Conversation target: ${state.conversationTarget ? renderConversationTarget(state.conversationTarget) : "core"}\n`);
  process.stdout.write(`Session: ${sessionPath}\n`);
  process.stdout.write("Recorded as a non-mutating conversation trace. Use `tedge trace latest --verbose` to inspect events.\n");
}
