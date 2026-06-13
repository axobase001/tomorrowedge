import path from "node:path";
import { accessModeSchema, type AccessMode } from "../../config/schema.js";
import { runAgentCouncilGovernance, type CouncilRunOptions } from "../../core/council/councilRuntime.js";
import { saveSession } from "../../core/memory/sessionMemory.js";
import { describeAccessPolicy } from "../../core/permissions/accessPolicy.js";
import { prepareRunWorkspace, resolveRuntimeConfig } from "../../core/runtime/runPreparation.js";

export type CouncilRunCliOptions = {
  cwd?: string;
  workdir?: string;
  accessMode?: string;
  fixtureMode?: boolean;
  headless?: boolean;
  approvePatch?: boolean;
  approveShell?: boolean;
  simulateFailure?: string;
};

export async function councilRunCommand(cwd: string, goal: string, options: CouncilRunCliOptions = {}): Promise<void> {
  const effectiveGoal = goal.trim();
  if (!effectiveGoal) throw new Error("Council goal is required.");
  const targetCwd = options.cwd || options.workdir ? path.resolve(cwd, options.cwd ?? options.workdir!) : cwd;
  const accessMode = parseAccessMode(options.accessMode);
  const { config } = await resolveRuntimeConfig(targetCwd, { task: effectiveGoal });
  const workspace = await prepareRunWorkspace(targetCwd, { fixtureMode: options.fixtureMode });
  const state = await runAgentCouncilGovernance(workspace.executionCwd, effectiveGoal, config, {
    accessMode,
    fixtureMode: options.fixtureMode,
    approvePatch: options.approvePatch,
    approveShell: options.approveShell,
    simulateFailureTaskId: options.simulateFailure
  } satisfies CouncilRunOptions);
  const sessionPath = await saveSession(targetCwd, state, { failureMemory: config.failure_memory });
  if (options.headless) {
    process.stdout.write(JSON.stringify({
      schemaVersion: "sirius-council-run/v1",
      sessionPath,
      executionCwd: workspace.executionCwd,
      access: state.access,
      accessSummary: describeAccessPolicy(state.access),
      chiefAgent: state.chiefAgent,
      chiefDecision: state.chiefDecision,
      council: state.council,
      taskGraph: state.plan?.taskGraph,
      delegatedTaskResults: state.delegatedTaskResults,
      strategyGenome: state.strategyGenome,
      strategyMutations: state.strategyMutations,
      strategySelection: state.strategySelection,
      finalChiefReview: state.finalChiefReview,
      traceCompleteness: state.traceCompleteness,
      summary: state.finalSummary
    }, null, 2) + "\n");
    return;
  }
  process.stdout.write(renderCouncilSummary(sessionPath, state));
}

function parseAccessMode(value: string | undefined): AccessMode | undefined {
  if (!value) return undefined;
  const parsed = accessModeSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid access mode "${value}". Use restricted, partial, or full.`);
  return parsed.data;
}

function renderCouncilSummary(sessionPath: string, state: Awaited<ReturnType<typeof runAgentCouncilGovernance>>): string {
  const owners = state.plan?.taskGraph?.nodes.map((node) =>
    `  ${node.id} -> ${node.ownerAgentId} (${node.assignedProvider}/${node.assignedModel ?? "model"}) :: ${node.assignmentReason}`
  ).join("\n") || "  none";
  const members = state.council?.members.map((member) => `${member.agentId}:${member.assignedCouncilRole}`).join(", ") || "none";
  const mutations = state.strategyMutations?.length
    ? state.strategyMutations.map((mutation) => `  ${mutation.type} after ${mutation.trigger}: ${mutation.reason}`).join("\n")
    : "  none";
  return [
    `Sirius Agent Council run: ${state.sessionId}`,
    `Session: ${sessionPath}`,
    `Chief Agent selected: ${state.chiefAgent?.id ?? "none"}`,
    `Chief decision: ${state.chiefDecision?.action ?? "none"} - ${state.chiefDecision?.reason ?? ""}`,
    `Council members: ${members}`,
    `Council consensus: ${state.council?.status ?? "none"}`,
    "Task ownership:",
    owners,
    "Mutation events:",
    mutations,
    `Final Chief Review: ${state.finalChiefReview?.decision ?? "none"}`,
    `Trace completeness: ${state.traceCompleteness?.score ?? 0}`,
    ""
  ].join("\n");
}
