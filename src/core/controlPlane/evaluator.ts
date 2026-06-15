import { existsSync } from "node:fs";
import path from "node:path";
import { findDeniedPathViolations } from "./diff.js";
import { createGate } from "./gates.js";
import { weakVerificationWarnings, type EvalSpec, type EvaluationResult, type GateResult, type GoalSpec, type ObservedWorkspaceState } from "./specs.js";

export type EvaluationRunnerInput = {
  cwd: string;
  goal: GoalSpec;
  evalSpec: EvalSpec;
  evidenceDir: string;
  iteration: number;
  observed: ObservedWorkspaceState;
  previousEvaluation?: EvaluationResult;
};

export class EvaluationRunner {
  async run(input: EvaluationRunnerInput): Promise<EvaluationResult> {
    const hardResults: GateResult[] = [];
    for (const spec of input.evalSpec.hard_gates) {
      const gate = createGate(spec);
      hardResults.push(await gate.run({
        cwd: input.cwd,
        goal: input.goal,
        evalSpec: input.evalSpec,
        evidenceDir: input.evidenceDir,
        iteration: input.iteration,
        observed: input.observed,
        previousEvaluation: input.previousEvaluation,
        currentGateResults: hardResults
      }));
    }

    const softResults: GateResult[] = [];
    for (const spec of input.evalSpec.soft_gates) {
      const gate = createGate(spec);
      softResults.push(await gate.run({
        cwd: input.cwd,
        goal: input.goal,
        evalSpec: input.evalSpec,
        evidenceDir: input.evidenceDir,
        iteration: input.iteration,
        observed: input.observed,
        previousEvaluation: input.previousEvaluation,
        currentGateResults: hardResults
      }));
    }

    const warnings = weakVerificationWarnings(input.evalSpec);
    const allHardPassed = hardResults.filter((item) => item.required).every((item) => item.passed);
    const missingEvidenceGateIds = input.evalSpec.evidence_required
      ? [...hardResults, ...softResults].filter((gate) => !gate.evidence_path && !gate.raw_output_path).map((gate) => gate.id)
      : [];
    const missingRequiredHardEvidenceGateIds = input.evalSpec.evidence_required
      ? hardResults.filter((gate) => gate.required && !gate.evidence_path && !gate.raw_output_path).map((gate) => gate.id)
      : [];
    if (missingEvidenceGateIds.length > 0) {
      warnings.push(`evidence missing for gates: ${missingEvidenceGateIds.join(", ")}`);
    }
    const requiredGateEvidenceComplete = missingRequiredHardEvidenceGateIds.length === 0;
    const conditionEvaluation = evaluateSuccessConditions(input.goal, input.evalSpec, input.cwd, input.observed, hardResults, softResults);
    const checkerConfidence = softResults.length > 0
      ? Math.max(...softResults.map((item) => item.score ?? 0))
      : null;
    const checkerThreshold = input.evalSpec.judge.mode === "hard_only"
      ? null
      : input.evalSpec.judge.min_confidence;
    const checkerSatisfied = checkerThreshold === null || checkerConfidence === null || checkerConfidence >= checkerThreshold;
    const confidence = computeConfidence({
      allHardPassed,
      requiredConditionsMet: conditionEvaluation.requiredConditionsMet,
      hardResults,
      softResults,
      checkerSatisfied
    });
    const converged = allHardPassed
      && conditionEvaluation.requiredConditionsMet
      && requiredGateEvidenceComplete
      && checkerSatisfied;

    return {
      hard_gate_results: hardResults,
      soft_gate_results: softResults,
      all_hard_gates_passed: allHardPassed,
      required_conditions_met: conditionEvaluation.requiredConditionsMet,
      required_gate_evidence_complete: requiredGateEvidenceComplete,
      missing_evidence_gate_ids: missingEvidenceGateIds,
      satisfied_conditions: conditionEvaluation.satisfiedConditions,
      missing_conditions: conditionEvaluation.missingConditions,
      regressions: hardResults.filter((item) => item.type === "no_regression" && !item.passed).map((item) => item.id),
      warnings,
      confidence,
      converged
    };
  }
}

function evaluateSuccessConditions(
  goal: GoalSpec,
  evalSpec: EvalSpec,
  cwd: string,
  observed: ObservedWorkspaceState,
  hardResults: GateResult[],
  softResults: GateResult[]
): { satisfiedConditions: string[]; missingConditions: string[]; requiredConditionsMet: boolean } {
  const satisfied: string[] = [];
  const missing: string[] = [];
  for (const condition of goal.desired_state.success_conditions) {
    const conditionSatisfied = (() => {
      if (condition.type === "diff_required") return observed.files_changed.length > 0 || hardResults.some((gate) => gate.type === "diff_required" && gate.passed);
      if (condition.type === "file_exists") {
        if (condition.path) return existsSync(path.resolve(cwd, condition.path));
        return goal.artifacts.required.length > 0 && goal.artifacts.required.every((artifact) => existsSync(path.resolve(cwd, artifact.path)));
      }
      if (condition.type === "no_regression") return hardResults.filter((gate) => gate.type === "no_regression").every((gate) => gate.passed);
      if (condition.type === "no_denied_path_modified") return findDeniedPathViolations(observed.files_changed, goal.constraints.denied_paths).length === 0;
      if (condition.type === "evidence_collected") {
        if (evalSpec.evidence_required) {
          const requiredHard = hardResults.filter((gate) => gate.required);
          return requiredHard.length > 0 && requiredHard.every((gate) => Boolean(gate.evidence_path || gate.raw_output_path));
        }
        return [...hardResults, ...softResults].some((gate) => Boolean(gate.evidence_path || gate.raw_output_path));
      }
      if (condition.type === "llm_review") return softResults.some((gate) => gate.passed && (gate.score ?? 0) >= 0.5);
      if (condition.type === "manual") return false;
      const exactGate = hardResults.find((gate) => gate.id === condition.id);
      if (exactGate) return exactGate.passed;
      const requiredHard = hardResults.filter((gate) => gate.required);
      return requiredHard.length === 0 ? false : requiredHard.every((gate) => gate.passed);
    })();
    if (conditionSatisfied) satisfied.push(condition.id);
    else if (condition.required) missing.push(condition.id);
  }
  return {
    satisfiedConditions: satisfied,
    missingConditions: missing,
    requiredConditionsMet: missing.length === 0
  };
}

function computeConfidence(input: {
  allHardPassed: boolean;
  requiredConditionsMet: boolean;
  hardResults: GateResult[];
  softResults: GateResult[];
  checkerSatisfied: boolean;
}): number {
  const hardScore = input.allHardPassed ? 0.6 : 0;
  const conditionScore = input.requiredConditionsMet ? 0.3 : 0;
  const softAverage = input.softResults.length
    ? input.softResults.reduce((sum, item) => sum + (item.score ?? 0), 0) / input.softResults.length
    : 1;
  const softScore = input.checkerSatisfied ? Math.min(0.1, softAverage * 0.1) : 0;
  const score = hardScore + conditionScore + softScore;
  return Math.round(score * 100) / 100;
}
