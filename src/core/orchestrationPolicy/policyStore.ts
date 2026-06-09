import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ScenarioType } from "../scenarios/scenarioTypes.js";
import { defaultOrchestrationPolicy, type OrchestrationPolicyGenome } from "./orchestrationPolicy.js";

export async function loadBestPolicy(cwd: string, scenarioType?: ScenarioType): Promise<OrchestrationPolicyGenome> {
  const policies = await readPolicies(cwd);
  const scoped = scenarioType ? policies.filter((policy) => policy.metadata.scenarioType === scenarioType) : policies;
  return scoped.sort((a, b) => (b.metadata.fitness ?? 0) - (a.metadata.fitness ?? 0))[0] ?? defaultOrchestrationPolicy();
}

export async function savePolicyScore(cwd: string, policy: OrchestrationPolicyGenome): Promise<void> {
  const policies = await readPolicies(cwd);
  const next = [policy, ...policies.filter((item) => item.policyId !== policy.policyId)].slice(0, 50);
  await mkdir(path.join(cwd, ".tomorrowedge"), { recursive: true });
  await writeFile(policyFile(cwd), JSON.stringify(next, null, 2), "utf8");
}

export async function readPolicies(cwd: string): Promise<OrchestrationPolicyGenome[]> {
  const text = await readFile(policyFile(cwd), "utf8").catch(() => "");
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as OrchestrationPolicyGenome[];
    return Array.isArray(parsed) ? parsed.filter((item) => item.schemaVersion === "orchestration-policy/v1") : [];
  } catch {
    return [];
  }
}

function policyFile(cwd: string): string {
  return path.join(cwd, ".tomorrowedge", "orchestration-policies.json");
}

