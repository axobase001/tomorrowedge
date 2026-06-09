import type { AccessMode, TomorrowEdgeConfig } from "../../config/schema.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import type { RiskLevel, TaskType } from "../../schemas/plan.js";
import { makeId } from "../../utils/ids.js";
import { nowIso } from "../../utils/time.js";
import type { EventPhase } from "../events/eventTypes.js";
import type { WorkflowIntentDecision } from "../goal/workflowIntent.js";
import { chatWithProviderFallback } from "../model/providerFallback.js";
import type { WorkflowKind } from "../orchestration/workflowKind.js";
import type { ModelRouter } from "../routing/router.js";
import type { ScenarioProfile } from "../scenarios/scenarioTypes.js";
import type { EventLedger } from "../events/eventLedger.js";
import type { ObjectiveTraceV1 } from "../traces/objectiveTrace.js";
import type { ObjectiveContractV1 } from "./objectiveContract.js";
import { verifyAndRepairContract } from "./contractVerifier.js";

export type NativeContractGeneratorInput = {
  goal: string;
  workflowIntent: WorkflowIntentDecision;
  scenarioProfile: ScenarioProfile;
  retrievedTraces: ObjectiveTraceV1[];
  config: TomorrowEdgeConfig;
  accessMode: AccessMode;
};

export function generateNativeObjectiveContract(input: NativeContractGeneratorInput): ObjectiveContractV1 {
  const workflowKind = workflowKindFor(input);
  const taskType = taskTypeFor(input.scenarioProfile, workflowKind);
  const riskLevel = riskLevelFor(input.scenarioProfile);
  const patchLike = workflowKind === "patch" || workflowKind === "vision_patch" || workflowKind === "repair";
  const restricted = input.accessMode === "restricted";
  const effectiveWorkflowKind = restricted && patchLike ? "read_only" : workflowKind;
  const allowedTools = allowedToolsFor(effectiveWorkflowKind, input.accessMode);
  const requiredCommands = patchLike && input.accessMode !== "restricted" ? ["npm test"] : [];
  const allowedRoles = allowedRolesFor(input.scenarioProfile.suggestedRoles, effectiveWorkflowKind, riskLevel);
  return {
    schemaVersion: "objective-contract/v1",
    contractId: makeId("objective_contract"),
    createdAt: nowIso(),
    goal: input.goal,
    normalizedGoal: normalizeGoal(input.goal),
    scenarioType: input.scenarioProfile.scenarioType,
    taskType,
    workflowKind: effectiveWorkflowKind,
    localObjective: localObjective(input.goal, input.scenarioProfile, effectiveWorkflowKind),
    userScenario: {
      inferredUserIntent: input.scenarioProfile.userIntent,
      expectedDeliverable: input.scenarioProfile.expectedDeliverable,
      interactionMode: interactionModeFor(input.scenarioProfile.scenarioType, effectiveWorkflowKind),
      ambiguityLevel: input.scenarioProfile.ambiguityLevel
    },
    successCriteria: successCriteriaFor(input.scenarioProfile, effectiveWorkflowKind),
    failureCriteria: failureCriteriaFor(effectiveWorkflowKind),
    requiredEvidence: requiredEvidenceFor(input.scenarioProfile, effectiveWorkflowKind),
    allowedPhases: allowedPhasesFor(effectiveWorkflowKind),
    allowedRoles,
    allowedTools,
    forbiddenActions: forbiddenActionsFor(input.accessMode, riskLevel),
    riskLevel,
    reasoningSensitivity: reasoningSensitivityFor(riskLevel, input.scenarioProfile.ambiguityLevel),
    budget: {
      maxSteps: Math.max(3, input.config.autonomy.max_iterations + 2),
      maxRepairRounds: input.accessMode === "restricted" ? 0 : input.config.autonomy.max_repairs,
      maxShellRuns: input.accessMode === "restricted" ? 0 : input.config.autonomy.max_shell_runs,
      maxToolCalls: Math.max(6, input.config.autonomy.max_iterations * 4),
      maxCostUsd: input.config.autonomy.max_cost_usd
    },
    uncertaintyPolicy: {
      whenToAskUser: input.scenarioProfile.ambiguityLevel === "high" ? ["User intent is too ambiguous to choose a safe workflow."] : [],
      whenToFallback: ["Model-backed contract generation fails validation.", "External role route is blocked or unavailable."],
      whenToProceedWithAssumption: ["Assumption is reversible, low-risk, and explicitly recorded in the event ledger."],
      whenToStop: ["Unsafe boundary violation is detected.", "Required evidence cannot be produced within budget."]
    },
    stopCondition: {
      success: successStopFor(effectiveWorkflowKind),
      partial: ["Some requested work completed, but required evidence or approval is missing."],
      failure: ["Verification failed after allowed repair rounds.", "No valid candidate or answer can satisfy the contract."],
      unsafe: ["Forbidden action requested.", "Access mode blocks the required mutation or shell command."]
    },
    fallbackPolicy: {
      plannerFallback: "native contract-derived planner",
      executorFallback: "native/mock/fixture role implementation with explicit fallback event",
      verifierFallback: "evidence packet plus local completion verifier",
      userEscalation: "ask user when ambiguity or safety boundary cannot be resolved"
    },
    verificationRubric: {
      requiredCommands,
      requiredArtifacts: effectiveWorkflowKind === "read_only" || effectiveWorkflowKind === "advisory" ? ["summary"] : ["diff", "review", "judge", "verification"],
      evidenceChecks: input.scenarioProfile.evidenceNeeds,
      reviewerChecks: riskLevel === "high" || patchLike ? ["Check correctness, scope, safety boundary, and missing evidence."] : [],
      judgeChecks: riskLevel === "high" || patchLike ? ["Select only candidates with required evidence and no blocking reviewer concern."] : []
    },
    traceHints: {
      similarTraceIds: input.retrievedTraces.map((trace) => trace.traceId).slice(0, 5),
      reusedLessons: input.retrievedTraces.flatMap((trace) => trace.outcome.lessons).slice(0, 5),
      avoidedFailurePatterns: input.retrievedTraces.map((trace) => trace.outcome.failureType).filter((item): item is string => Boolean(item)).slice(0, 5)
    },
    source: input.retrievedTraces.length ? "trace_guided" : "native",
    confidence: input.scenarioProfile.ambiguityLevel === "high" ? 0.55 : input.retrievedTraces.length ? 0.82 : 0.74
  };
}

export async function generateModelBackedObjectiveContract(input: NativeContractGeneratorInput & {
  router: ModelRouter;
  ledger: EventLedger;
  localOnly?: boolean;
}): Promise<{ contract: ObjectiveContractV1; provider: string; model: string; fallbackUsed: boolean; error?: string }> {
  const native = generateNativeObjectiveContract(input);
  if (input.localOnly) {
    return { contract: native, provider: "native", model: "contract-generator", fallbackUsed: true, error: "local-only mode" };
  }
  const assignment = input.router.assignmentFor("planner");
  const result = await chatWithProviderFallback({
    config: input.config,
    router: input.router,
    role: "planner",
    provider: assignment.provider,
    model: assignment.model,
    ledger: input.ledger,
    buildRequest: (model) => ({
      model,
      temperature: 0,
      maxCompletionTokens: 1100,
      responseFormat: { type: "json_object" },
      metadata: { tomorrowedgeTask: "objective_contract" },
      messages: [
        { role: "system", content: "Return a strict ObjectiveContractV1 JSON object for TomorrowEdge. Do not expand permissions beyond the supplied native baseline." },
        { role: "user", content: JSON.stringify({ nativeBaseline: native, scenarioProfile: input.scenarioProfile }, null, 2) }
      ]
    })
  });
  const parsed = parseContract(result.response?.content);
  if (!parsed) {
    return { contract: native, provider: result.response ? result.provider : "native", model: result.response ? result.model : "contract-generator", fallbackUsed: true, error: result.error ?? "invalid contract JSON" };
  }
  const verification = verifyAndRepairContract(parsed, {
    accessMode: input.accessMode,
    workflowIntent: input.workflowIntent,
    scenarioProfile: input.scenarioProfile,
    config: input.config,
    baseline: native
  });
  return {
    contract: verification.contract,
    provider: result.provider,
    model: result.model,
    fallbackUsed: result.fallbackUsed || verification.verification.status !== "passed"
  };
}

function parseContract(content?: string): ObjectiveContractV1 | undefined {
  if (!content) return undefined;
  const object = parseJsonObject(content);
  if (!object || object.schemaVersion !== "objective-contract/v1") return undefined;
  return object as ObjectiveContractV1;
}

function parseJsonObject(content: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    const match = /\{[\s\S]*\}/.exec(content);
    if (!match) return undefined;
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
    } catch {
      return undefined;
    }
  }
}

function workflowKindFor(input: NativeContractGeneratorInput): WorkflowKind {
  return input.workflowIntent.workflowKind ?? input.scenarioProfile.likelyWorkflowKind;
}

function taskTypeFor(profile: ScenarioProfile, workflowKind: WorkflowKind): TaskType {
  if (workflowKind === "read_only" || workflowKind === "advisory" || workflowKind === "ask_user") return "analysis";
  if (profile.scenarioType === "debugging") return "bugfix";
  if (profile.scenarioType === "refactor") return "refactor";
  if (profile.scenarioType === "document") return "docs";
  if (profile.scenarioType === "analysis" || profile.scenarioType === "research" || profile.scenarioType === "planning") return "analysis";
  if (profile.scenarioType === "coding") return "feature";
  return "unknown";
}

function riskLevelFor(profile: ScenarioProfile): RiskLevel {
  if (profile.riskSignals.some((signal) => signal === "security_sensitive" || signal === "irreversible_or_production")) return "high";
  if (profile.riskSignals.length || profile.ambiguityLevel === "medium") return "medium";
  return "low";
}

function interactionModeFor(scenarioType: ScenarioProfile["scenarioType"], workflowKind: WorkflowKind): ObjectiveContractV1["userScenario"]["interactionMode"] {
  if (workflowKind === "patch" || workflowKind === "vision_patch" || workflowKind === "repair") return "code_change";
  if (scenarioType === "document") return "artifact";
  if (scenarioType === "research" || scenarioType === "analysis" || scenarioType === "planning") return "analysis";
  return "answer";
}

function successCriteriaFor(profile: ScenarioProfile, workflowKind: WorkflowKind): string[] {
  const criteria = [`Satisfy the local objective for the ${profile.scenarioType} scenario.`];
  if (workflowKind === "patch" || workflowKind === "vision_patch" || workflowKind === "repair") {
    criteria.push("Produce an inspectable patch candidate or explicitly justify no-op.");
    criteria.push("Reviewer and judge decisions are recorded before final delivery.");
    criteria.push("Configured verification command passes or is explicitly skipped with rationale.");
  } else {
    criteria.push("Return a read-only answer or artifact summary grounded in inspected evidence.");
  }
  return criteria;
}

function failureCriteriaFor(workflowKind: WorkflowKind): string[] {
  const failures = ["Required evidence is missing.", "The final answer claims completion without matching the event ledger."];
  if (workflowKind === "patch" || workflowKind === "vision_patch" || workflowKind === "repair") {
    failures.push("Patch is applied without allowed access mode or approval.");
    failures.push("Verification fails after allowed repair rounds.");
  }
  return failures;
}

function requiredEvidenceFor(profile: ScenarioProfile, workflowKind: WorkflowKind): string[] {
  const evidence = new Set(profile.evidenceNeeds);
  evidence.add("objective contract");
  evidence.add("contract verification");
  if (workflowKind === "patch" || workflowKind === "vision_patch" || workflowKind === "repair") {
    evidence.add("patch diff");
    evidence.add("review decision");
    evidence.add("judge decision");
    evidence.add("shell or verifier result");
  }
  return [...evidence];
}

function allowedPhasesFor(workflowKind: WorkflowKind): EventPhase[] {
  const common: EventPhase[] = ["routing", "planning", "exploration", "summary", "memory"];
  if (workflowKind === "read_only" || workflowKind === "advisory" || workflowKind === "ask_user") return common;
  return [...common, "vision", "coding", "review", "judge", "patch", "shell", "repair", "verification"];
}

function allowedRolesFor(suggested: AgentRole[], workflowKind: WorkflowKind, riskLevel: RiskLevel): AgentRole[] {
  const roles = new Set<AgentRole>(suggested);
  roles.add("planner");
  roles.add("explorer");
  roles.add("summarizer");
  if (workflowKind === "patch" || workflowKind === "vision_patch" || workflowKind === "repair") {
    roles.add("explorer");
    roles.add("coder_a");
    roles.add("coder_b");
    roles.add("reviewer");
    roles.add("judge");
    roles.add("runner");
    roles.add("repairer");
  }
  if (riskLevel === "high") {
    roles.add("reviewer");
    roles.add("judge");
  }
  return [...roles];
}

function allowedToolsFor(workflowKind: WorkflowKind, accessMode: AccessMode): string[] {
  const tools = new Set(["repo_index", "file_read", "grep", "model_chat", "event_ledger"]);
  if (accessMode !== "restricted" && (workflowKind === "patch" || workflowKind === "vision_patch" || workflowKind === "repair")) {
    tools.add("patch_apply");
    tools.add("shell");
    tools.add("undo");
  }
  return [...tools];
}

function forbiddenActionsFor(accessMode: AccessMode, riskLevel: RiskLevel): string[] {
  const actions = ["bypass_event_ledger", "weaken_safety_boundary", "hide_model_call"];
  if (accessMode === "restricted") actions.push("write_files", "apply_patch", "run_shell");
  if (riskLevel === "high") actions.push("skip_reviewer", "skip_judge", "claim_success_without_evidence");
  return actions;
}

function successStopFor(workflowKind: WorkflowKind): string[] {
  if (workflowKind === "patch" || workflowKind === "vision_patch" || workflowKind === "repair") {
    return ["Selected patch is applied or explicitly blocked by approval policy.", "Required verification evidence is recorded.", "Final summary references changed files and residual risk."];
  }
  return ["Read-only answer or artifact summary is produced.", "No patch/shell mutation is attempted.", "Evidence and stop reason are recorded."];
}

function localObjective(goal: string, profile: ScenarioProfile, workflowKind: WorkflowKind): string {
  return `${profile.expectedDeliverable} for: ${clip(goal, 180)}${workflowKind === "read_only" ? " (read-only)" : ""}`;
}

function reasoningSensitivityFor(riskLevel: RiskLevel, ambiguity: ScenarioProfile["ambiguityLevel"]): ObjectiveContractV1["reasoningSensitivity"] {
  if (riskLevel === "high" || ambiguity === "high") return "high";
  if (riskLevel === "medium" || ambiguity === "medium") return "medium";
  return "low";
}

function normalizeGoal(goal: string): string {
  return goal.replace(/\s+/g, " ").trim();
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}
