import { createWorkspaceSnapshot, computeDesiredStateDiff, findAllowedPathViolations, findDeniedPathViolations, observeWorkspace } from "./diff.js";
import { EvaluationRunner } from "./evaluator.js";
import { writeEvidenceJson } from "./evidence.js";
import { MockAgentAdapter, type ControlPlaneActionResult, type ControlPlaneAgentAdapter } from "./adapters.js";
import { StatusStore } from "./statusStore.js";
import type { DesiredStateDiff, EvalSpec, EvaluationResult, GoalSpec, LoopSpec, StatusSpec } from "./specs.js";
import { makeId } from "../../utils/ids.js";

export type ControlPlaneRunOptions = {
  cwd: string;
  goal: GoalSpec;
  evaluation: EvalSpec;
  loop: LoopSpec;
  adapter?: ControlPlaneAgentAdapter;
  runId?: string;
  statusRoot?: string;
};

export type ControlPlaneRunResult = {
  runId: string;
  runDir: string;
  status: StatusSpec;
  iterations: number;
  converged: boolean;
  aborted: boolean;
  tracePath: string;
  latestStatusPath: string;
  progressPath: string;
};

type DecisionState = {
  repeatedFailures: number;
  noProgressRounds: number;
  previousProgressKey?: string;
};

export class ReconciliationController {
  private readonly evaluator = new EvaluationRunner();

  async run(options: ControlPlaneRunOptions): Promise<ControlPlaneRunResult> {
    const adapter = options.adapter ?? new MockAgentAdapter();
    const runId = options.runId ?? makeId("control_run");
    const store = new StatusStore(options.cwd, runId, options.statusRoot);
    const startedAt = new Date().toISOString();
    await store.initialize();

    const baseline = await createWorkspaceSnapshot(options.cwd).catch(() => undefined);
    let previousEvaluation: EvaluationResult | undefined;
    let lastStatus = buildStatus({
      runId,
      goal: options.goal,
      iteration: 0,
      phase: "initialized",
      observed: { files_changed: [], git_available: false, diff_basis: "snapshot" },
      testsRun: [],
      commandsRun: [],
      blockers: [],
      errors: [],
      diff: computeDesiredStateDiff(options.goal),
      gateResults: [],
      artifacts: [],
      logs: [],
      decision: {
        should_continue: true,
        reason: "initialized",
        next_action: "observe",
        confidence: null
      },
      startedAt
    });
    await store.writeStatus(lastStatus);

    const decisionState: DecisionState = {
      repeatedFailures: 0,
      noProgressRounds: 0
    };
    const maxIterations = Math.min(options.loop.max_iterations, options.goal.constraints.max_iterations ?? options.loop.max_iterations);

    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      const evidenceDir = store.evidenceDir(iteration);
      const preObserved = await observeWorkspace(options.cwd, baseline);
      const preEvaluation = await this.evaluator.run({
        cwd: options.cwd,
        goal: options.goal,
        evalSpec: options.evaluation,
        evidenceDir: `${evidenceDir}/pre_action`,
        iteration,
        observed: preObserved,
        previousEvaluation
      });
      await writeEvidenceJson(evidenceDir, "pre_gate_results.json", evaluationSnapshot(preEvaluation), "pre-action gate results");
      const preDelta = computeDesiredStateDiff(options.goal, preEvaluation);
      const preBlockers = collectBlockers(options.goal, options.loop, emptyAction(adapter.id), preObserved.files_changed, preEvaluation);
      if (shouldConverge({ loop: options.loop, evaluation: preEvaluation, blockers: preBlockers })) {
        const decision = {
          shouldContinue: false,
          reason: "converged: all configured ConvergencePolicy stop conditions passed before action",
          nextAction: null,
          phase: "converged" as const
        };
        await writeEvidenceJson(evidenceDir, "changed_files.json", {
          adapter: adapter.id,
          action: emptyAction(adapter.id),
          before_changed_files: preObserved.files_changed,
          after_changed_files: preObserved.files_changed
        }, "changed files after action");
        await writeEvidenceJson(evidenceDir, "post_gate_results.json", evaluationSnapshot(preEvaluation), "post-action gate results");
        await writeEvidenceJson(evidenceDir, "gate_results.json", evaluationSnapshot(preEvaluation), "structured gate results");
        await writeEvidenceJson(evidenceDir, "controller_decision.json", {
          decision,
          blockers: preBlockers,
          action: emptyAction(adapter.id)
        }, "controller decision");
        lastStatus = buildStatus({
          runId,
          goal: options.goal,
          iteration,
          phase: "converged",
          evaluationPhase: "pre_action",
          preActionGateResults: [...preEvaluation.hard_gate_results, ...preEvaluation.soft_gate_results],
          observed: preObserved,
          testsRun: testCommands(options.evaluation),
          commandsRun: hardGateCommands(options.evaluation),
          blockers: preBlockers,
          errors: [],
          diff: preDelta,
          gateResults: [...preEvaluation.hard_gate_results, ...preEvaluation.soft_gate_results],
          artifacts: [],
          logs: gateLogs(preEvaluation),
          decision: {
            should_continue: false,
            reason: decision.reason,
            next_action: null,
            confidence: preEvaluation.confidence
          },
          startedAt
        });
        await store.writeStatus(lastStatus);
        previousEvaluation = preEvaluation;
        break;
      }

      const action = await adapter.act({
        cwd: options.cwd,
        goal: options.goal,
        iteration,
        observed: preObserved,
        delta: preDelta,
        status: lastStatus,
        evidenceDir
      });
      const postObserved = await observeWorkspace(options.cwd, baseline);
      const postEvaluation = await this.evaluator.run({
        cwd: options.cwd,
        goal: options.goal,
        evalSpec: options.evaluation,
        evidenceDir,
        iteration,
        observed: postObserved,
        previousEvaluation
      });
      await writeEvidenceJson(evidenceDir, "post_gate_results.json", evaluationSnapshot(postEvaluation), "post-action gate results");
      const postDelta = computeDesiredStateDiff(options.goal, postEvaluation);
      const blockers = collectBlockers(options.goal, options.loop, action, postObserved.files_changed, postEvaluation);
      updateDecisionState({
        state: decisionState,
        evaluation: postEvaluation,
        diff: postDelta,
        changedFiles: postObserved.files_changed,
        action
      });
      const finalDecision = decideAfterPostEvaluation({
        loop: options.loop,
        goal: options.goal,
        iteration,
        maxIterations,
        evaluation: postEvaluation,
        blockers,
        state: decisionState,
        action
      });
      await writeEvidenceJson(evidenceDir, "changed_files.json", {
        adapter: adapter.id,
        action,
        before_changed_files: preObserved.files_changed,
        after_changed_files: postObserved.files_changed
      }, "changed files after action");
      await writeEvidenceJson(evidenceDir, "gate_results.json", evaluationSnapshot(postEvaluation), "structured gate results");
      await writeEvidenceJson(evidenceDir, "controller_decision.json", {
        decision: finalDecision,
        blockers,
        action
      }, "controller decision");
      const phase = finalDecision.phase;
      lastStatus = buildStatus({
        runId,
        goal: options.goal,
        iteration,
        phase,
        evaluationPhase: "post_action",
        preActionGateResults: [...preEvaluation.hard_gate_results, ...preEvaluation.soft_gate_results],
        observed: postObserved,
        testsRun: testCommands(options.evaluation),
        commandsRun: [
          ...action.commandsRun,
          ...hardGateCommands(options.evaluation)
        ],
        blockers,
        errors: action.error ? [{ source: adapter.id, message: action.error }] : [],
        diff: postDelta,
        gateResults: [...postEvaluation.hard_gate_results, ...postEvaluation.soft_gate_results],
        artifacts: action.artifacts,
        logs: gateLogs(postEvaluation),
        decision: {
          should_continue: finalDecision.shouldContinue,
          reason: finalDecision.reason,
          next_action: finalDecision.nextAction,
          confidence: postEvaluation.confidence
        },
        startedAt
      });
      await store.writeStatus(lastStatus);
      previousEvaluation = postEvaluation;
      if (!finalDecision.shouldContinue) break;
    }

    return {
      runId,
      runDir: store.runDir,
      status: lastStatus,
      iterations: lastStatus.iteration,
      converged: lastStatus.phase === "converged",
      aborted: lastStatus.phase === "aborted",
      tracePath: store.tracePath,
      latestStatusPath: store.latestPath,
      progressPath: store.progressPath
    };
  }
}

function emptyAction(adapterId: string): ControlPlaneActionResult {
  return {
    status: "skipped",
    summary: `No ${adapterId} action was applied before evaluation.`,
    changedFiles: [],
    commandsRun: [],
    artifacts: []
  };
}

function collectBlockers(goal: GoalSpec, loop: LoopSpec, action: ControlPlaneActionResult, changedFiles: string[], evaluation: EvaluationResult): string[] {
  const blockers: string[] = [];
  const denied = findDeniedPathViolations(changedFiles, goal.constraints.denied_paths);
  if (denied.length > 0) blockers.push(`modified denied path: ${denied.join(", ")}`);
  const outsideAllowed = findAllowedPathViolations(changedFiles, goal.constraints.allowed_paths);
  if (outsideAllowed.length > 0) blockers.push(`modified path outside allowed_paths: ${outsideAllowed.join(", ")}`);
  if (goal.constraints.max_files_changed !== null && changedFiles.length > goal.constraints.max_files_changed) {
    blockers.push(`too many files changed: ${changedFiles.length} > ${goal.constraints.max_files_changed}`);
  }
  if (!evaluation.all_hard_gates_passed) {
    blockers.push(`blocking checks failed: ${evaluation.hard_gate_results.filter((gate) => gate.required && !gate.passed).map((gate) => gate.id).join(", ") || "unknown"}`);
  }
  if (evaluation.hard_gate_results.some((gate) => gate.required && !gate.passed) && evaluation.soft_gate_results.some((gate) => gate.passed)) {
    blockers.push("reviewer/advisory check passed but blocking checks failed; advisory checks cannot override blocking checks");
  }
  if (action.budgetExhausted && loop.abort_when.budget_exhausted) {
    blockers.push("budget exhausted");
  }
  for (const warning of evaluation.warnings) {
    if (warning.includes("weakly verifiable") || warning.includes("evidence missing")) blockers.push(`warning: ${warning}`);
  }
  return blockers;
}

export function shouldConverge(input: {
  loop: LoopSpec;
  evaluation: EvaluationResult;
  blockers: string[];
}): boolean {
  if (input.loop.stop_when.all_hard_gates_pass && !input.evaluation.all_hard_gates_passed) return false;
  if (input.loop.stop_when.all_required_conditions_met && !input.evaluation.required_conditions_met) return false;
  if (!input.evaluation.required_gate_evidence_complete) return false;
  if (input.loop.stop_when.no_unresolved_blockers && input.blockers.length > 0) return false;
  if (
    input.loop.stop_when.checker_confidence_above !== null
    && input.evaluation.confidence < input.loop.stop_when.checker_confidence_above
  ) return false;
  return true;
}

function decideAfterPostEvaluation(input: {
  loop: LoopSpec;
  goal: GoalSpec;
  iteration: number;
  maxIterations: number;
  evaluation: EvaluationResult;
  blockers: string[];
  state: DecisionState;
  action: ControlPlaneActionResult;
}): { shouldContinue: boolean; reason: string; nextAction: string | null; phase: StatusSpec["phase"] } {
  const denied = input.blockers.find((item) => item.startsWith("modified denied path"));
  if (denied) return { shouldContinue: false, reason: `aborted: ${denied}`, nextAction: null, phase: "aborted" };
  const outsideAllowed = input.blockers.find((item) => item.startsWith("modified path outside allowed_paths"));
  if (outsideAllowed) return { shouldContinue: false, reason: `aborted: ${outsideAllowed}`, nextAction: null, phase: "aborted" };
  const tooMany = input.blockers.find((item) => item.startsWith("too many files changed"));
  if (tooMany) return { shouldContinue: false, reason: `aborted: ${tooMany}`, nextAction: null, phase: "aborted" };
  if (shouldConverge(input)) {
    return { shouldContinue: false, reason: "converged: all configured ConvergencePolicy stop conditions passed", nextAction: null, phase: "converged" };
  }
  if (input.loop.abort_when.budget_exhausted && input.action.budgetExhausted) {
    return { shouldContinue: false, reason: "aborted: budget exhausted", nextAction: null, phase: "aborted" };
  }
  if (input.loop.abort_when.repeated_failure_rounds > 0 && input.state.repeatedFailures >= input.loop.abort_when.repeated_failure_rounds) {
    const failedGateIds = input.evaluation.hard_gate_results.filter((gate) => gate.required && !gate.passed).map((gate) => gate.id);
    const reason = failedGateIds.length > 0
      ? `aborted: blocking check always failing after ${input.state.repeatedFailures} post-action round(s): ${failedGateIds.join(", ")}`
      : `aborted: repeated failure for ${input.state.repeatedFailures} round(s)`;
    return { shouldContinue: false, reason, nextAction: null, phase: "aborted" };
  }
  if (input.loop.abort_when.no_progress_rounds > 0 && input.state.noProgressRounds >= input.loop.abort_when.no_progress_rounds) {
    return { shouldContinue: false, reason: `aborted: no progress for ${input.state.noProgressRounds} consecutive rounds`, nextAction: null, phase: "aborted" };
  }
  if (input.loop.abort_when.max_iterations_reached && input.iteration >= input.maxIterations) {
    return { shouldContinue: false, reason: `aborted: max iterations reached (${input.maxIterations})`, nextAction: null, phase: "aborted" };
  }
  return {
    shouldContinue: true,
    reason: input.evaluation.all_hard_gates_passed ? "continue: ConvergencePolicy stop conditions not satisfied" : "continue: blocking checks still failing after AgentBridge action",
    nextAction: "reconcile missing conditions",
    phase: "evaluating"
  };
}

function buildStatus(input: {
  runId: string;
  goal: GoalSpec;
  iteration: number;
  phase: StatusSpec["phase"];
  evaluationPhase?: StatusSpec["evaluation_phase"];
  preActionGateResults?: StatusSpec["pre_action_gate_results"];
  observed: { files_changed: string[]; git_available: boolean; diff_basis?: "run_baseline" | "git_status" | "snapshot" };
  testsRun: string[];
  commandsRun: string[];
  blockers: string[];
  errors: Array<Record<string, unknown>>;
  diff: DesiredStateDiff;
  gateResults: StatusSpec["evidence"]["gate_results"];
  artifacts: Array<Record<string, unknown>>;
  logs: Array<Record<string, unknown>>;
  decision: StatusSpec["decision"];
  startedAt: string;
}): StatusSpec {
  return {
    run_id: input.runId,
    goal_id: input.goal.id,
    iteration: input.iteration,
    phase: input.phase,
    evaluation_phase: input.evaluationPhase,
    pre_action_gate_results: input.preActionGateResults,
    observed_state: {
      files_changed: input.observed.files_changed,
      tests_run: input.testsRun,
      commands_run: input.commandsRun,
      current_errors: input.errors,
      unresolved_blockers: input.blockers,
      git_available: input.observed.git_available,
      diff_basis: input.observed.diff_basis
    },
    desired_state_ref: `goal:${input.goal.id}`,
    diff: input.diff,
    evidence: {
      artifacts: input.artifacts,
      logs: input.logs,
      gate_results: input.gateResults
    },
    decision: input.decision,
    timestamps: {
      started_at: input.startedAt,
      updated_at: new Date().toISOString()
    }
  };
}

function updateDecisionState(input: {
  state: DecisionState;
  evaluation: EvaluationResult;
  diff: DesiredStateDiff;
  changedFiles: string[];
  action: ControlPlaneActionResult;
}): void {
  const failedGateIds = input.evaluation.hard_gate_results.filter((gate) => gate.required && !gate.passed).map((gate) => gate.id);
  input.state.repeatedFailures = failedGateIds.length > 0 ? input.state.repeatedFailures + 1 : 0;
  const progressKey = [
    `satisfied=${input.diff.satisfied_conditions.slice().sort().join(",")}`,
    `missing=${input.diff.missing_conditions.slice().sort().join(",")}`,
    `failed=${failedGateIds.slice().sort().join(",")}`,
    `changed=${input.changedFiles.slice().sort().join(",")}`,
    `action=${input.action.status}`
  ].join("|");
  input.state.noProgressRounds = input.state.previousProgressKey === progressKey ? input.state.noProgressRounds + 1 : 0;
  input.state.previousProgressKey = progressKey;
}

function evaluationSnapshot(evaluation: EvaluationResult): Record<string, unknown> {
  return {
    hard_gates: evaluation.hard_gate_results,
    soft_gates: evaluation.soft_gate_results,
    all_hard_gates_passed: evaluation.all_hard_gates_passed,
    required_conditions_met: evaluation.required_conditions_met,
    required_gate_evidence_complete: evaluation.required_gate_evidence_complete,
    missing_evidence_gate_ids: evaluation.missing_evidence_gate_ids,
    warnings: evaluation.warnings,
    confidence: evaluation.confidence,
    converged: evaluation.converged
  };
}

function gateLogs(evaluation: EvaluationResult): Array<Record<string, unknown>> {
  return [...evaluation.hard_gate_results, ...evaluation.soft_gate_results]
    .filter((gate) => gate.raw_output_path)
    .map((gate) => ({ gate_id: gate.id, path: gate.raw_output_path }));
}

function testCommands(evaluation: EvalSpec): string[] {
  return evaluation.hard_gates.filter((gate) => gate.type === "test").map((gate) => gate.command ?? gate.id);
}

function hardGateCommands(evaluation: EvalSpec): string[] {
  return evaluation.hard_gates.filter((gate) => gate.command).map((gate) => gate.command as string);
}
