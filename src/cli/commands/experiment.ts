import { isErrorLoopAblation, runErrorLoopExperiment, type ErrorLoopAblation } from "../../core/eval/errorLoopExperiment.js";
import type { MemoryRetrievalPolicyMode } from "../../core/memory/retrievalPolicy.js";

export type ErrorLoopExperimentCliOptions = {
  tasks?: string;
  repetitions?: string;
  ablation?: string;
  outputDir?: string;
  seed?: string;
  memoryPolicy?: string;
  json?: boolean;
};

export async function experimentErrorLoopCommand(cwd: string, options: ErrorLoopExperimentCliOptions = {}): Promise<void> {
  const result = await runErrorLoopExperiment(cwd, {
    tasks: splitList(options.tasks),
    repetitions: parsePositiveInt(options.repetitions, 1),
    ablations: parseAblations(options.ablation),
    outputDir: options.outputDir,
    seed: options.seed,
    memoryPolicy: parseMemoryPolicy(options.memoryPolicy)
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(renderExperimentSummary(result));
}

function renderExperimentSummary(result: Awaited<ReturnType<typeof runErrorLoopExperiment>>): string {
  return [
    `Error-loop experiment: ${result.id}`,
    `Output: ${result.outputDir}`,
    "",
    "| Trials | Completed | Failures | Memory written | Retrieval decisions | Policy exploit/bypass |",
    "| ---: | ---: | ---: | ---: | ---: | ---: |",
    `| ${result.metrics.trials} | ${result.metrics.completed} | ${result.metrics.failures} | ${result.metrics.memoryWritten} | ${result.metrics.retrievalDecisions} | ${result.metrics.memoryPolicyExploit}/${result.metrics.memoryPolicyBypass} |`,
    "",
    `Report: ${result.reportPath}`,
    `Manifest: ${result.manifestPath}`,
    `Cohorts: ${result.cohortMetricsPath}`
  ].join("\n") + "\n";
}

function splitList(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined;
  return value.split(/[;\n]/).map((item) => item.trim()).filter(Boolean);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseAblations(value: string | undefined): ErrorLoopAblation[] | undefined {
  if (!value?.trim()) return undefined;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(isErrorLoopAblation);
}

function parseMemoryPolicy(value: string | undefined): MemoryRetrievalPolicyMode | undefined {
  if (!value) return undefined;
  return ["balanced", "exploit_memory", "explore_alternative", "random_control"].includes(value)
    ? value as MemoryRetrievalPolicyMode
    : undefined;
}
