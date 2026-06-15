import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { z } from "zod";

export const goalModeSchema = z.enum(["coding", "research", "refactor", "test", "docs", "generic"]);
export const successConditionTypeSchema = z.enum([
  "test",
  "command",
  "file_exists",
  "diff_required",
  "no_regression",
  "no_denied_path_modified",
  "evidence_collected",
  "llm_review",
  "manual"
]);
export const hardGateTypeSchema = z.enum([
  "command",
  "test",
  "lint",
  "typecheck",
  "static_analysis",
  "file_exists",
  "diff_required",
  "no_regression"
]);
export const softGateTypeSchema = z.enum([
  "checker_agent",
  "architecture_review",
  "security_review",
  "regression_review"
]);
export const gateTypeSchema = z.union([hardGateTypeSchema, softGateTypeSchema]);

export const successConditionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  type: successConditionTypeSchema,
  required: z.boolean(),
  path: z.string().min(1).optional()
}).strict();

export const goalSpecSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  mode: goalModeSchema,
  desired_state: z.object({
    summary: z.string().min(1),
    success_conditions: z.array(successConditionSchema).min(1)
  }).strict(),
  constraints: z.object({
    allowed_paths: z.array(z.string()).default(["."]),
    denied_paths: z.array(z.string()).default([".git", ".runs"]),
    max_files_changed: z.number().int().positive().nullable().default(null),
    max_iterations: z.number().int().positive().nullable().default(null),
    require_human_review: z.boolean().default(false)
  }).strict(),
  artifacts: z.object({
    required: z.array(z.object({
      path: z.string().min(1),
      description: z.string().min(1)
    }).strict()).default([])
  }).strict().default({ required: [] })
}).strict().superRefine((goal, ctx) => {
  const required = goal.desired_state.success_conditions.filter((item) => item.required);
  if (required.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["desired_state", "success_conditions"],
      message: "ObjectiveContract must define at least one required, structured success condition."
    });
  }
});

export const gateSpecSchema = z.object({
  id: z.string().min(1),
  type: gateTypeSchema,
  command: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  timeout_sec: z.number().int().positive().default(60),
  required: z.boolean(),
  threshold: z.number().min(0).max(1).nullable().optional()
}).strict().superRefine((gate, ctx) => {
  if (["command", "test", "lint", "typecheck", "static_analysis"].includes(gate.type) && !gate.command) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["command"],
      message: `${gate.type} gate requires command.`
    });
  }
  if (gate.type === "file_exists" && !gate.path) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["path"],
      message: "file_exists gate requires path."
    });
  }
});

export const evalSpecSchema = z.object({
  hard_gates: z.array(gateSpecSchema).default([]),
  soft_gates: z.array(gateSpecSchema).default([]),
  judge: z.object({
    mode: z.enum(["hard_only", "hard_plus_checker", "full_matrix"]),
    checker_role: z.string().nullable().default(null),
    min_confidence: z.number().min(0).max(1)
  }).strict(),
  evidence_required: z.boolean()
}).strict();

export const retryPolicySchema = z.object({
  type: z.enum(["none", "fixed", "exponential_backoff"]),
  base_delay_sec: z.number().int().nonnegative(),
  max_delay_sec: z.number().int().nonnegative()
}).strict();

export const loopSpecSchema = z.object({
  max_iterations: z.number().int().positive(),
  strategy: z.literal("reconcile"),
  one_item_per_loop: z.boolean(),
  fresh_context_each_iteration: z.boolean(),
  retry_policy: retryPolicySchema,
  stop_when: z.object({
    all_hard_gates_pass: z.boolean(),
    all_required_conditions_met: z.boolean(),
    checker_confidence_above: z.number().min(0).max(1).nullable(),
    no_unresolved_blockers: z.boolean()
  }).strict(),
  abort_when: z.object({
    max_iterations_reached: z.boolean(),
    no_progress_rounds: z.number().int().nonnegative(),
    repeated_failure_rounds: z.number().int().nonnegative(),
    budget_exhausted: z.boolean()
  }).strict()
}).strict();

export const controlPlaneSpecDocumentSchema = z.object({
  goal: goalSpecSchema,
  evaluation: evalSpecSchema.optional(),
  loop: loopSpecSchema.optional()
}).strict();

export type GoalMode = z.infer<typeof goalModeSchema>;
export type SuccessConditionType = z.infer<typeof successConditionTypeSchema>;
export type SuccessCondition = z.infer<typeof successConditionSchema>;
export type GoalSpec = z.infer<typeof goalSpecSchema>;
export type GateSpec = z.infer<typeof gateSpecSchema>;
export type EvalSpec = z.infer<typeof evalSpecSchema>;
export type LoopSpec = z.infer<typeof loopSpecSchema>;
export type ControlPlaneSpecDocument = z.infer<typeof controlPlaneSpecDocumentSchema>;

export type GateResult = {
  id: string;
  type: string;
  required: boolean;
  passed: boolean;
  score: number | null;
  summary: string;
  evidence_path: string | null;
  raw_output_path: string | null;
  error: string | null;
};

export type EvaluationResult = {
  hard_gate_results: GateResult[];
  soft_gate_results: GateResult[];
  all_hard_gates_passed: boolean;
  required_conditions_met: boolean;
  required_gate_evidence_complete: boolean;
  missing_evidence_gate_ids: string[];
  satisfied_conditions: string[];
  missing_conditions: string[];
  regressions: string[];
  warnings: string[];
  confidence: number;
  converged: boolean;
};

export type ObservedWorkspaceState = {
  files_changed: string[];
  changed_file_count: number;
  git_available: boolean;
  diff_basis?: "run_baseline" | "git_status" | "snapshot";
  snapshot_hash?: string;
};

export type DesiredStateDiff = {
  missing_conditions: string[];
  satisfied_conditions: string[];
  regressions: string[];
  unknown_conditions: string[];
};

export type StatusPhase = "initialized" | "observing" | "acting" | "evaluating" | "converged" | "failed" | "aborted";

export type StatusSpec = {
  run_id: string;
  goal_id: string;
  iteration: number;
  phase: StatusPhase;
  evaluation_phase?: "pre_action" | "post_action";
  pre_action_gate_results?: GateResult[];
  observed_state: {
    files_changed: string[];
    tests_run: string[];
    commands_run: string[];
    current_errors: Array<Record<string, unknown>>;
    unresolved_blockers: string[];
    git_available?: boolean;
    diff_basis?: "run_baseline" | "git_status" | "snapshot";
  };
  desired_state_ref: string;
  diff: DesiredStateDiff;
  evidence: {
    artifacts: Array<Record<string, unknown>>;
    logs: Array<Record<string, unknown>>;
    gate_results: GateResult[];
  };
  decision: {
    should_continue: boolean;
    reason: string;
    next_action: string | null;
    confidence: number | null;
  };
  timestamps: {
    started_at: string;
    updated_at: string;
  };
};

export async function loadControlPlaneSpecDocument(specPath: string): Promise<ControlPlaneSpecDocument> {
  const raw = await readFile(specPath, "utf8");
  return parseControlPlaneSpecDocument(raw);
}

export function parseControlPlaneSpecDocument(raw: string): ControlPlaneSpecDocument {
  const parsed = YAML.parse(raw) as unknown;
  return controlPlaneSpecDocumentSchema.parse(parsed);
}

export function defaultLoopSpec(goal: GoalSpec): LoopSpec {
  return {
    max_iterations: goal.constraints.max_iterations ?? 3,
    strategy: "reconcile",
    one_item_per_loop: true,
    fresh_context_each_iteration: true,
    retry_policy: {
      type: "none",
      base_delay_sec: 0,
      max_delay_sec: 0
    },
    stop_when: {
      all_hard_gates_pass: true,
      all_required_conditions_met: true,
      checker_confidence_above: null,
      no_unresolved_blockers: true
    },
    abort_when: {
      max_iterations_reached: true,
      no_progress_rounds: 2,
      repeated_failure_rounds: 3,
      budget_exhausted: true
    }
  };
}

export function requireRunnableControlPlaneDocument(document: ControlPlaneSpecDocument): Required<ControlPlaneSpecDocument> {
  if (!document.evaluation) {
    throw new Error("Canopus run requires an evaluation section. AcceptanceMatrix is not optional for execution.");
  }
  return {
    goal: document.goal,
    evaluation: document.evaluation,
    loop: document.loop ?? defaultLoopSpec(document.goal)
  };
}

export function weakVerificationWarnings(evaluation: EvalSpec): string[] {
  if (evaluation.hard_gates.length === 0) {
    return ["objective is weakly verifiable: no blocking checks are configured"];
  }
  return [];
}

export function controlPlaneSemanticWarnings(document: ControlPlaneSpecDocument): string[] {
  const warnings = document.evaluation ? weakVerificationWarnings(document.evaluation) : ["control run requires evaluation; validation only"];
  const hardGateIds = new Set(document.evaluation?.hard_gates.map((gate) => gate.id) ?? []);
  for (const condition of document.goal.desired_state.success_conditions) {
    if (!condition.required) continue;
    const evaluatorKnown = [
      "diff_required",
      "file_exists",
      "no_regression",
      "no_denied_path_modified",
      "evidence_collected",
      "llm_review"
    ].includes(condition.type);
    if (condition.type === "manual") {
      warnings.push(`required condition ${condition.id} is manual and cannot be automatically converged`);
    } else if (!evaluatorKnown && !hardGateIds.has(condition.id)) {
      warnings.push(`required condition ${condition.id} has no matching blocking check or built-in evaluator`);
    }
  }
  return warnings;
}

export function createDefaultControlPlaneDocument(title: string, mode: GoalMode = "coding"): ControlPlaneSpecDocument {
  const id = slugifyId(title || "control-goal");
  return {
    goal: {
      id,
      title,
      description: title,
      mode,
      desired_state: {
        summary: "The requested repository state is reached and verified by blocking checks.",
        success_conditions: [
          {
            id: "verification_passes",
            description: "The configured verification command must pass.",
            type: "test",
            required: true
          },
          {
            id: "diff_exists",
            description: "A relevant workspace change must exist.",
            type: "diff_required",
            required: true
          }
        ]
      },
      constraints: {
        allowed_paths: ["."],
        denied_paths: [".git", ".runs"],
        max_files_changed: 10,
        max_iterations: 5,
        require_human_review: false
      },
      artifacts: {
        required: []
      }
    },
    evaluation: {
      hard_gates: [
        {
          id: "verification",
          type: "command",
          command: "npm test",
          timeout_sec: 120,
          required: true
        }
      ],
      soft_gates: [
        {
          id: "checker_review",
          type: "checker_agent",
          required: false,
          threshold: 0.75,
          timeout_sec: 30
        } as GateSpec
      ],
      judge: {
        mode: "hard_plus_checker",
        checker_role: "reviewer",
        min_confidence: 0.75
      },
      evidence_required: true
    },
    loop: {
      max_iterations: 5,
      strategy: "reconcile",
      one_item_per_loop: true,
      fresh_context_each_iteration: true,
      retry_policy: {
        type: "exponential_backoff",
        base_delay_sec: 1,
        max_delay_sec: 8
      },
      stop_when: {
        all_hard_gates_pass: true,
        all_required_conditions_met: true,
        checker_confidence_above: 0.75,
        no_unresolved_blockers: true
      },
      abort_when: {
        max_iterations_reached: true,
        no_progress_rounds: 2,
        repeated_failure_rounds: 3,
        budget_exhausted: true
      }
    }
  };
}

function slugifyId(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return slug || "control_goal";
}
