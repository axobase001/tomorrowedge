import { loadConfig } from "../../config/configLoader.js";
import { runAgentDrill } from "../../core/eval/agentDrill.js";

export type DrillOptions = {
  fixture?: string;
  providers?: string;
  includeMock?: boolean;
};

export async function drillCommand(cwd: string, task: string, options: DrillOptions = {}): Promise<void> {
  const config = loadConfig(cwd);
  const result = await runAgentDrill(cwd, task, config, {
    fixture: options.fixture,
    providers: options.providers?.split(",").map((item) => item.trim()).filter(Boolean),
    includeMock: options.includeMock
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.status === "no_providers" || result.status === "blocked") {
    process.exitCode = 1;
  }
}
