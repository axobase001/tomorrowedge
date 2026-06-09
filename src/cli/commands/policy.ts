import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveRuntimeConfig } from "../../core/runtime/runPreparation.js";
import { evolvePoliciesOffline } from "../../core/orchestrationPolicy/policyEvolution.js";
import { evaluatePolicyFitness } from "../../core/orchestrationPolicy/policyEvaluator.js";
import { readPolicies, loadBestPolicy, savePolicyScore } from "../../core/orchestrationPolicy/policyStore.js";
import { readTraces } from "../../core/traces/traceStore.js";

export async function policyInspectCommand(cwd: string, options: { json?: boolean } = {}): Promise<void> {
  const { config } = await resolveRuntimeConfig(cwd);
  const stored = await readPolicies(cwd);
  const best = await loadBestPolicy(cwd);
  const payload = {
    config: config.self_iterating_orchestration,
    bestPolicy: best,
    storedPolicies: stored.slice(0, 10)
  };
  if (options.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return;
  }
  process.stdout.write([
    "Orchestration Policy",
    "====================",
    `mode: ${config.self_iterating_orchestration.enabled ? config.self_iterating_orchestration.mode : "off"}`,
    `allow policy mutation: ${config.self_iterating_orchestration.allow_policy_mutation ? "yes" : "no"}`,
    `allow offline evolution: ${config.self_iterating_orchestration.allow_offline_evolution ? "yes" : "no"}`,
    `best policy: ${best.policyId}`,
    `fitness: ${best.metadata.fitness ?? "not scored"}`,
    `contract depth: ${best.contractPolicy.contractDepth}`,
    `trace top-k: ${best.tracePolicy.traceTopK}`,
    `verification strictness: ${best.verificationPolicy.verificationStrictness}`,
    `repair rounds: ${best.repairPolicy.maxRepairRounds}`,
    `stop mode: ${best.stopPolicy.stopMode}`,
    `stored policies: ${stored.length}`,
    ""
  ].join("\n"));
}

export async function policyEvolveCommand(cwd: string, options: { offline?: boolean; generations?: string; population?: string; elite?: string; json?: boolean } = {}): Promise<void> {
  const { config } = await resolveRuntimeConfig(cwd);
  const traces = await readTraces(cwd, { limit: 200, newestFirst: true });
  if (!traces.length) {
    process.stdout.write("No objective traces found. Run a workflow first, then retry policy evolution.\n");
    return;
  }
  if (!config.self_iterating_orchestration.allow_offline_evolution) {
    process.stdout.write("Offline policy evolution is disabled by config.self_iterating_orchestration.allow_offline_evolution.\n");
    return;
  }
  const generations = parsePositiveInt(options.generations, 1);
  const population = parsePositiveInt(options.population, config.self_iterating_orchestration.max_policy_variants);
  const eliteRetention = parsePositiveInt(options.elite, config.self_iterating_orchestration.elite_retention);
  let basePolicy = await loadBestPolicy(cwd);
  const generationResults = [];
  for (let generation = 1; generation <= generations; generation += 1) {
    const result = evolvePoliciesOffline({
      basePolicy,
      traces,
      maxPolicyVariants: population,
      eliteRetention
    });
    for (const selected of result.selected) {
      await savePolicyScore(cwd, selected);
    }
    basePolicy = result.selected[0] ?? basePolicy;
    generationResults.push({
      generation,
      selected: result.selected,
      bestFitness: result.selected[0]?.metadata.fitness ?? 0,
      variants: result.variants.length,
      traces: traces.length
    });
  }
  const payload = {
    mode: "offline",
    generations,
    population,
    eliteRetention,
    traceCount: traces.length,
    selectedPolicy: basePolicy,
    generationResults
  };
  if (options.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return;
  }
  process.stdout.write([
    "Policy Evolution",
    "================",
    `mode: offline`,
    `generations: ${generations}`,
    `population: ${population}`,
    `elite retention: ${eliteRetention}`,
    `trace count: ${traces.length}`,
    `selected policy: ${basePolicy.policyId}`,
    `fitness: ${basePolicy.metadata.fitness ?? "not scored"}`,
    ""
  ].join("\n"));
}

export async function policyEvalCommand(cwd: string, options: { taskset?: string; json?: boolean } = {}): Promise<void> {
  const traces = await readTraces(cwd, { limit: 200, newestFirst: true });
  const policy = await loadBestPolicy(cwd);
  const scores = traces.map((trace) => ({ traceId: trace.traceId, scenario: trace.scenarioProfile.scenarioType, fitness: evaluatePolicyFitness(policy, trace) }));
  const averageFitness = scores.length ? Math.round(scores.reduce((sum, item) => sum + item.fitness.finalFitness, 0) / scores.length) : 0;
  const tasksetSummary = options.taskset ? await readTasksetSummary(cwd, options.taskset) : undefined;
  const payload = {
    policy,
    traceCount: traces.length,
    averageFitness,
    scores,
    taskset: tasksetSummary
  };
  if (options.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return;
  }
  process.stdout.write([
    "Policy Evaluation",
    "=================",
    `policy: ${policy.policyId}`,
    `trace count: ${traces.length}`,
    `average fitness: ${averageFitness}`,
    tasksetSummary ? `taskset: ${tasksetSummary.path} (${tasksetSummary.items} item(s), ${tasksetSummary.note})` : "taskset: not provided",
    ""
  ].join("\n"));
}

function parsePositiveInt(value: string | number | undefined, fallback: number): number {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function readTasksetSummary(cwd: string, taskset: string): Promise<{ path: string; items: number; note: string }> {
  const resolved = path.isAbsolute(taskset) ? taskset : path.resolve(cwd, taskset);
  const text = await readFile(resolved, "utf8").catch(() => "");
  if (!text) return { path: resolved, items: 0, note: "not readable" };
  const trimmed = text.trim();
  if (!trimmed) return { path: resolved, items: 0, note: "empty" };
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown[];
      return { path: resolved, items: Array.isArray(parsed) ? parsed.length : 1, note: "json" };
    } catch {
      return { path: resolved, items: trimmed.split(/\r?\n/).filter(Boolean).length, note: "invalid json, counted lines" };
    }
  }
  return { path: resolved, items: trimmed.split(/\r?\n/).filter(Boolean).length, note: "line-delimited" };
}
