import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { EvalSpec, EvaluationResult, GateResult, GateSpec, GoalSpec, ObservedWorkspaceState } from "./specs.js";
import { runApprovedCommand } from "../tools/shellTool.js";

export type GateContext = {
  cwd: string;
  goal: GoalSpec;
  evalSpec: EvalSpec;
  evidenceDir: string;
  iteration: number;
  observed: ObservedWorkspaceState;
  previousEvaluation?: EvaluationResult;
  currentGateResults?: GateResult[];
};

export interface Gate {
  id: string;
  type: string;
  required: boolean;
  run(context: GateContext): Promise<GateResult>;
}

export class CommandGate implements Gate {
  readonly id: string;
  readonly type: string;
  readonly required: boolean;

  constructor(private readonly spec: GateSpec) {
    this.id = spec.id;
    this.type = spec.type;
    this.required = spec.required;
  }

  async run(context: GateContext): Promise<GateResult> {
    const command = this.spec.command ?? "";
    const timeoutMs = (this.spec.timeout_sec ?? 60) * 1000;
    const started = Date.now();
    try {
      const result = await runShellCommand(command, context.cwd, timeoutMs);
      const rawPath = await writeGateLog(context.evidenceDir, this.id, [
        `$ ${command}`,
        `exit_code=${result.exitCode}`,
        `duration_ms=${Date.now() - started}`,
        "",
        "# stdout",
        result.stdout,
        "",
        "# stderr",
        result.stderr
      ].join("\n"));
      const passed = result.exitCode === 0 && !result.timedOut;
      return {
        id: this.id,
        type: this.type,
        required: this.required,
        passed,
        score: passed ? 1 : 0,
        summary: passed ? `${this.type} gate passed` : `${this.type} gate failed with exit code ${result.exitCode}`,
        evidence_path: rawPath,
        raw_output_path: rawPath,
        error: result.timedOut ? `timed out after ${this.spec.timeout_sec}s` : result.error
      };
    } catch (error) {
      return failedGate(this.spec, `command gate failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export class FileExistsGate implements Gate {
  readonly id: string;
  readonly type: string;
  readonly required: boolean;

  constructor(private readonly spec: GateSpec) {
    this.id = spec.id;
    this.type = spec.type;
    this.required = spec.required;
  }

  async run(context: GateContext): Promise<GateResult> {
    try {
      const target = this.spec.path ?? "";
      const absolute = path.resolve(context.cwd, target);
      const passed = existsSync(absolute);
      const evidencePath = await writeGateLog(context.evidenceDir, this.id, JSON.stringify({ path: target, exists: passed }, null, 2));
      return {
        id: this.id,
        type: this.type,
        required: this.required,
        passed,
        score: passed ? 1 : 0,
        summary: passed ? `file exists: ${target}` : `missing file: ${target}`,
        evidence_path: evidencePath,
        raw_output_path: evidencePath,
        error: passed ? null : `missing file: ${target}`
      };
    } catch (error) {
      return failedGate(this.spec, `file_exists gate failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export class DiffRequiredGate implements Gate {
  readonly id: string;
  readonly type: string;
  readonly required: boolean;

  constructor(private readonly spec: GateSpec) {
    this.id = spec.id;
    this.type = spec.type;
    this.required = spec.required;
  }

  async run(context: GateContext): Promise<GateResult> {
    try {
      const changed = context.observed.files_changed;
      const evidencePath = await writeGateLog(context.evidenceDir, this.id, JSON.stringify({ files_changed: changed }, null, 2), "json");
      const passed = changed.length > 0;
      return {
        id: this.id,
        type: this.type,
        required: this.required,
        passed,
        score: passed ? 1 : 0,
        summary: passed ? `${changed.length} changed file(s) detected` : "no workspace diff detected",
        evidence_path: evidencePath,
        raw_output_path: evidencePath,
        error: passed ? null : "no diff exists"
      };
    } catch (error) {
      return failedGate(this.spec, `diff_required gate failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export class NoRegressionGate implements Gate {
  readonly id: string;
  readonly type: string;
  readonly required: boolean;

  constructor(private readonly spec: GateSpec) {
    this.id = spec.id;
    this.type = spec.type;
    this.required = spec.required;
  }

  async run(context: GateContext): Promise<GateResult> {
    try {
      const previousFailed = context.previousEvaluation?.hard_gate_results.filter((item) => item.required && !item.passed).length ?? Infinity;
      const currentFailed = context.currentGateResults?.filter((item) => item.required && !item.passed).length ?? 0;
      const passed = previousFailed === Infinity || currentFailed <= previousFailed;
      const evidencePath = await writeGateLog(context.evidenceDir, this.id, JSON.stringify({ previousFailed, currentFailed, passed }, null, 2), "json");
      return {
        id: this.id,
        type: this.type,
        required: this.required,
        passed,
        score: passed ? 1 : 0,
        summary: passed ? "no hard-gate regression detected" : "hard-gate regression detected",
        evidence_path: evidencePath,
        raw_output_path: evidencePath,
        error: passed ? null : "regression detected"
      };
    } catch (error) {
      return failedGate(this.spec, `no_regression gate failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export class CheckerAgentGateStub implements Gate {
  readonly id: string;
  readonly type: string;
  readonly required: boolean;

  constructor(private readonly spec: GateSpec) {
    this.id = spec.id;
    this.type = spec.type;
    this.required = spec.required;
  }

  async run(context: GateContext): Promise<GateResult> {
    try {
      const hardFailures = context.currentGateResults?.filter((item) => item.required && !item.passed) ?? [];
      const passed = true;
      const score = 1.0;
      const evidencePath = await writeGateLog(context.evidenceDir, this.id, JSON.stringify({
        checker: "stub",
        hard_failures_visible: hardFailures.map((item) => item.id),
        note: "reviewer_role is advisory only and cannot override blocking-check failure"
      }, null, 2), "json");
      return {
        id: this.id,
        type: this.type,
        required: this.required,
        passed,
        score,
        summary: hardFailures.length > 0
          ? "checker stub passed softly, but hard-gate failures remain authoritative"
          : "checker stub passed",
        evidence_path: evidencePath,
        raw_output_path: evidencePath,
        error: null
      };
    } catch (error) {
      return failedGate(this.spec, `review_agent advisory check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export function createGate(spec: GateSpec): Gate {
  if (["command", "test", "lint", "typecheck", "static_analysis"].includes(spec.type)) return new CommandGate(spec);
  if (spec.type === "file_exists") return new FileExistsGate(spec);
  if (spec.type === "diff_required") return new DiffRequiredGate(spec);
  if (spec.type === "no_regression") return new NoRegressionGate(spec);
  return new CheckerAgentGateStub(spec);
}

export async function writeGateLog(evidenceDir: string, gateId: string, content: string, extension = "log"): Promise<string> {
  await mkdir(evidenceDir, { recursive: true });
  const safeId = gateId.replace(/[^a-zA-Z0-9_.-]+/g, "_");
  const target = path.join(evidenceDir, `${safeId}.${extension}`);
  await writeFile(target, content, "utf8");
  return target;
}

function failedGate(spec: GateSpec, error: string): GateResult {
  return {
    id: spec.id,
    type: spec.type,
    required: spec.required,
    passed: false,
    score: 0,
    summary: error,
    evidence_path: null,
    raw_output_path: null,
    error
  };
}

async function runShellCommand(command: string, cwd: string, timeoutMs: number): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean; error: string | null }> {
  const result = await runApprovedCommand(cwd, command, {
    approved: true,
    policy: "verification_allowlist",
    timeoutMs
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: false,
    error: null
  };
}
