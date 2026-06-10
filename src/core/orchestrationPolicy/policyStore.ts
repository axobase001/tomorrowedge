import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ScenarioType } from "../scenarios/scenarioTypes.js";
import { defaultOrchestrationPolicy, migratePolicyToV2, type OrchestrationPolicyGenome } from "./orchestrationPolicy.js";

export async function loadBestPolicy(cwd: string, scenarioType?: ScenarioType): Promise<OrchestrationPolicyGenome> {
  const policies = await readPolicies(cwd);
  if (!policies.length) return defaultOrchestrationPolicy();
  const scoped = scenarioType ? policies.filter((policy) => policy.metadata.scenarioType === scenarioType) : policies;
  const global = scenarioType ? policies.filter((policy) => !policy.metadata.scenarioType) : [];
  return bestPolicy(scoped) ?? bestPolicy(global) ?? defaultOrchestrationPolicy();
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
    return Array.isArray(parsed)
      ? parsed
        .filter((item) => item.schemaVersion === "orchestration-policy/v1" || item.schemaVersion === "orchestration-policy/v2")
        .map(normalizePolicy)
      : [];
  } catch {
    return [];
  }
}

function policyFile(cwd: string): string {
  return path.join(cwd, ".tomorrowedge", "orchestration-policies.json");
}

function bestPolicy(policies: OrchestrationPolicyGenome[]): OrchestrationPolicyGenome | undefined {
  return [...policies].sort((a, b) => (b.metadata.fitness ?? 0) - (a.metadata.fitness ?? 0))[0];
}

function normalizePolicy(policy: OrchestrationPolicyGenome): OrchestrationPolicyGenome {
  const migrated = migratePolicyToV2(policy);
  const base = defaultOrchestrationPolicy(migrated.metadata.createdAt);
  return {
    ...base,
    ...migrated,
    contractPolicy: { ...base.contractPolicy, ...migrated.contractPolicy },
    tracePolicy: { ...base.tracePolicy, ...migrated.tracePolicy },
    planningPolicy: { ...base.planningPolicy, ...migrated.planningPolicy },
    routingPolicy: { ...base.routingPolicy, ...migrated.routingPolicy },
    toolRoutingPolicy: { ...base.toolRoutingPolicy, ...migrated.toolRoutingPolicy },
    verificationPolicy: { ...base.verificationPolicy, ...migrated.verificationPolicy },
    repairPolicy: { ...base.repairPolicy, ...migrated.repairPolicy },
    stopPolicy: { ...base.stopPolicy, ...migrated.stopPolicy },
    debatePolicy: { ...base.debatePolicy!, ...migrated.debatePolicy },
    taskGraphPolicy: { ...base.taskGraphPolicy!, ...migrated.taskGraphPolicy },
    externalAgentPolicy: { ...base.externalAgentPolicy!, ...migrated.externalAgentPolicy },
    metadata: { ...base.metadata, ...migrated.metadata }
  };
}
