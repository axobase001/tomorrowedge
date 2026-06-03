import { loadConfig } from "../../config/configLoader.js";
import { runWorkflowSimulation } from "../../core/eval/workflowSimulation.js";

export type WorkflowOptions = {
  providers?: string;
  output?: "json" | "markdown";
  rounds?: string;
};

export async function workflowCommand(cwd: string, task: string, options: WorkflowOptions = {}): Promise<void> {
  const config = loadConfig(cwd);
  const result = await runWorkflowSimulation(cwd, task, config, {
    providers: options.providers?.split(",").map((item) => item.trim()).filter(Boolean),
    output: options.output,
    rounds: options.rounds ? Number(options.rounds) : undefined
  });
  if (options.output === "json") {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  process.stdout.write(`workflow: ${result.id}\n`);
  process.stdout.write(`verdict: ${result.review.verdict}\n`);
  process.stdout.write(`report: ${result.reportPath}\n`);
  process.stdout.write(`usage_tokens: ${result.usageSummary.totalTokens}\n`);
  process.stdout.write(`budget: ${result.budgetStatus.status}\n`);
}
