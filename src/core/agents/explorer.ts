import { BaseAgent } from "./baseAgent.js";
import type { AgentContext } from "./baseAgent.js";
import type { Plan } from "../../schemas/plan.js";
import type { ContextSelection } from "../context/fileSelector.js";
import { indexRepository } from "../context/repoIndexer.js";

export class ExplorerAgent extends BaseAgent<{ plan: Plan }, ContextSelection> {
  readonly role = "explorer";

  async run(input: { plan: Plan }, context: AgentContext): Promise<ContextSelection> {
    const files = await indexRepository(context.cwd);
    const selected = files.slice(0, 12).map((file) => ({
      path: file.path,
      reason: `Visible project file for ${input.plan.taskType} context.`,
      risk: file.risk
    }));
    return {
      selectedFiles: selected,
      excludedFiles: files.filter((file) => file.risk !== "safe").map((file) => ({ path: file.path, reason: `Excluded as ${file.risk}.` })),
      grepQueriesUsed: [],
      contextSummary: selected.length ? `Selected ${selected.length} visible files.` : "No visible files selected yet."
    };
  }
}
