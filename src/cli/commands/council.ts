import path from "node:path";
import { accessModeSchema, type AccessMode } from "../../config/schema.js";
import { runAgentCouncilGovernance, type CouncilRunOptions } from "../../core/council/councilRuntime.js";
import { saveSession } from "../../core/memory/sessionMemory.js";
import { describeAccessPolicy } from "../../core/permissions/accessPolicy.js";
import { prepareRunWorkspace, resolveRuntimeConfig } from "../../core/runtime/runPreparation.js";
import { normalizeUserSuppliedText } from "../../utils/textEncoding.js";

export type CouncilRunCliOptions = {
  cwd?: string;
  workdir?: string;
  accessMode?: string;
  fixtureMode?: boolean;
  headless?: boolean;
  approvePatch?: boolean;
  approveShell?: boolean;
  simulateFailure?: string;
  config?: string;
};

export async function councilRunCommand(cwd: string, goal: string, options: CouncilRunCliOptions = {}): Promise<void> {
  const normalizedGoal = normalizeUserSuppliedText(goal);
  if (normalizedGoal.repaired) {
    process.stderr.write(`Warning: repaired probable CLI text encoding issue: ${normalizedGoal.reason}.\n`);
  }
  const effectiveGoal = normalizedGoal.text;
  if (!effectiveGoal) throw new Error("Council goal is required.");
  const targetCwd = options.cwd || options.workdir ? path.resolve(cwd, options.cwd ?? options.workdir!) : cwd;
  const explicitConfigPath = options.config ? path.resolve(cwd, options.config) : undefined;
  const accessMode = parseAccessMode(options.accessMode);
  const runtimeConfig = await resolveRuntimeConfig(targetCwd, { task: effectiveGoal, configPath: explicitConfigPath });
  const { config } = runtimeConfig;
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
      sessionId: state.sessionId,
      sessionPath,
      configSource: runtimeConfig.configSource,
      configPath: runtimeConfig.configPath,
      executionCwd: workspace.executionCwd,
      ...buildHeadlessEventSummary(state.events),
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

type CouncilState = Awaited<ReturnType<typeof runAgentCouncilGovernance>>;
type CouncilEvent = CouncilState["events"][number];

function buildHeadlessEventSummary(events: CouncilEvent[]): {
  eventCount: number;
  eventTypeCounts: Record<string, number>;
  traceEventSample: Array<Record<string, unknown>>;
} {
  const eventTypeCounts: Record<string, number> = {};
  for (const event of events) {
    eventTypeCounts[event.type] = (eventTypeCounts[event.type] ?? 0) + 1;
  }
  return {
    eventCount: events.length,
    eventTypeCounts,
    traceEventSample: events
      .filter((event) => headlessSampleEventTypes.has(event.type))
      .slice(0, 20)
      .map(compactTraceEvent)
  };
}

const headlessSampleEventTypes = new Set([
  "chief_agent_selected",
  "chief_initial_plan",
  "council_session_started",
  "council_move",
  "council_consensus",
  "task_ownership_assignment",
  "delegated_task_result",
  "task_ownership_reassignment",
  "strategy_mutation",
  "strategy_selection_decision",
  "chief_final_review",
  "chief_delivery_approved",
  "chief_revision_requested"
]);

function compactTraceEvent(event: CouncilEvent): Record<string, unknown> {
  const raw = event as unknown as Record<string, unknown>;
  const compact: Record<string, unknown> = {
    type: event.type
  };
  for (const key of ["phase", "role", "source", "speakerAgentId", "externalAgentId", "taskNodeId", "ownerAgentId", "oldOwnerAgentId", "newOwnerAgentId", "status", "decision", "action", "summary"]) {
    if (raw[key] !== undefined) compact[key] = raw[key];
  }
  return compact;
}

function parseAccessMode(value: string | undefined): AccessMode | undefined {
  if (!value) return undefined;
  const parsed = accessModeSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid access mode "${value}". Use restricted, partial, or full.`);
  return parsed.data;
}

function renderCouncilSummary(sessionPath: string, state: CouncilState): string {
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
