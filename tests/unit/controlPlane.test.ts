import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { objectiveContractToGoalSpec, type ControlPlaneAgentAdapter, type ControlPlaneActionInput, type ControlPlaneActionResult, NoopAgentAdapter, ShellAgentAdapter, SiriusCouncilActuatorAdapter } from "../../src/core/controlPlane/adapters.js";
import { loadConfigWithSource } from "../../src/config/configLoader.js";
import { ReconciliationController, shouldConverge } from "../../src/core/controlPlane/controller.js";
import { EvaluationRunner } from "../../src/core/controlPlane/evaluator.js";
import { computeDesiredStateDiff, createWorkspaceSnapshot, findAllowedPathViolations, observeWorkspace } from "../../src/core/controlPlane/diff.js";
import { createGate } from "../../src/core/controlPlane/gates.js";
import { controlPlaneSchemaWarnings, controlPlaneSemanticWarnings, controlPlaneValidationWarnings, loadControlPlaneSpecDocument, parseControlPlaneSpecDocument, requireRunnableControlPlaneDocument, type EvalSpec, type EvaluationResult, type GoalSpec, type LoopSpec } from "../../src/core/controlPlane/specs.js";
import { parseCanopusSpecDocument, type AcceptanceMatrix, type CanopusObjective, type ConvergencePolicy, type RunState } from "../../src/core/canopus/index.js";
import { StatusStore } from "../../src/core/controlPlane/statusStore.js";
import type { ObjectiveContractV1 } from "../../src/core/contracts/objectiveContract.js";

describe("Canopus Runtime specs", () => {
  it("validates a structured Canopus objective document", async () => {
    const spec = parseControlPlaneSpecDocument(validGoalYaml());

    expect(spec.goal.id).toBe("simple_bugfix");
    expect(spec.goal.desired_state.success_conditions[0].id).toBe("unit_tests_pass");
    expect(spec.evaluation?.hard_gates[0].command).toBe(nodePassCommand());
  });

  it("parses the public Canopus objective/acceptance/convergence schema", () => {
    const spec = parseControlPlaneSpecDocument(canopusObjectiveYaml());

    expect(spec.goal.id).toBe("simple_bugfix");
    expect(spec.goal.desired_state.success_conditions[0].id).toBe("unit_tests_pass");
    expect(spec.evaluation?.hard_gates[0].id).toBe("unit_tests_pass");
    expect(spec.evaluation?.judge.checker_role).toBe("reviewer");
    expect(controlPlaneSchemaWarnings(spec)).toEqual([]);
  });

  it("parses the legacy control schema with a deprecation warning", () => {
    const spec = parseControlPlaneSpecDocument(validGoalYaml());

    expect(spec.goal.id).toBe("simple_bugfix");
    expect(controlPlaneSchemaWarnings(spec).join("\n")).toContain("legacy `goal/evaluation/loop` schema");
    expect(controlPlaneSemanticWarnings(spec)).toEqual([]);
    expect(controlPlaneValidationWarnings(spec).join("\n")).toContain("legacy");
  });

  it("keeps the public src/core/canopus re-export layer importable", () => {
    const spec = parseCanopusSpecDocument(canopusObjectiveYaml());
    const objective: CanopusObjective = spec.goal;
    const acceptance: AcceptanceMatrix | undefined = spec.evaluation;
    const convergence: ConvergencePolicy | undefined = spec.loop;
    const runState = null as RunState | null;

    expect(objective.id).toBe("simple_bugfix");
    expect(acceptance?.hard_gates[0].id).toBe("unit_tests_pass");
    expect(convergence?.max_iterations).toBe(3);
    expect(runState).toBeNull();
  });

  it("rejects a prompt-like goal without required structured success conditions", () => {
    expect(() => parseControlPlaneSpecDocument([
      "goal:",
      "  id: prompt_only",
      "  title: Fix it",
      "  description: Please fix the repo however you want.",
      "  mode: coding",
      "  desired_state:",
      "    summary: make it good",
      "    success_conditions: []",
      "  constraints:",
      "    allowed_paths: ['.']",
      "    denied_paths: ['.git', '.runs']",
      "    max_files_changed: 5",
      "    max_iterations: 2",
      "    require_human_review: false"
    ].join("\n"))).toThrow(/success_conditions/);
  });

  it("rejects description-only goals that omit structured desired state", () => {
    expect(() => parseControlPlaneSpecDocument([
      "goal:",
      "  id: prompt_only",
      "  title: Fix it",
      "  description: Please fix the repo however you want.",
      "  mode: coding"
    ].join("\n"))).toThrow();
  });

  it("rejects unsupported gate types and command gates without commands", () => {
    expect(() => parseControlPlaneSpecDocument(validGoalYaml({ hardGateType: "magic" }))).toThrow();
    expect(() => parseControlPlaneSpecDocument(validGoalYaml({ command: "" }))).toThrow();
  });

  it("allows empty blocking checks only with weak verification warnings", () => {
    const document = parseControlPlaneSpecDocument(validGoalYaml({ omitHardGates: true, conditionType: "manual", conditionId: "manual_review" }));
    const warnings = controlPlaneSemanticWarnings(document);

    expect(warnings.join("\n")).toContain("weakly verifiable");
    expect(warnings.join("\n")).toContain("manual_review");
  });

  it("warns when a required condition has no blocking check or built-in evaluator", () => {
    const document = parseControlPlaneSpecDocument(validGoalYaml({ conditionId: "unit_tests_pass", conditionType: "test", hardGateId: "different_gate" }));
    const warnings = controlPlaneSemanticWarnings(document);

    expect(warnings.join("\n")).toContain("unit_tests_pass");
    expect(warnings.join("\n")).toContain("no matching blocking check or built-in evaluator");
  });

  it("keeps the official runtime demo semantically clean", async () => {
    const document = await loadControlPlaneSpecDocument(path.join(process.cwd(), "examples", "control_plane", "simple_bugfix_runtime", "goal.yaml"));

    expect(controlPlaneSemanticWarnings(document)).toEqual([]);
    expect(document.evaluation?.hard_gates[0].id).toBe("unit_tests_pass");
    expect(document.evaluation?.hard_gates[0].type).toBe("test");
  });

  it("keeps the public Canopus runtime demo semantically clean", async () => {
    const document = await loadControlPlaneSpecDocument(path.join(process.cwd(), "examples", "canopus", "simple_bugfix_runtime", "objective.yaml"));

    expect(controlPlaneValidationWarnings(document)).toEqual([]);
    expect(document.evaluation?.hard_gates[0].id).toBe("unit_tests_pass");
  });
});

describe("Canopus Runtime gates and evaluator", () => {
  it("passes command gates with exit code 0", async () => {
    const cwd = await tempDir("tedge-control-gate-pass-");
    try {
      const gate = createGate({ id: "pass", type: "command", command: nodePassCommand(), timeout_sec: 10, required: true });
      const result = await gate.run(gateContext(cwd));

      expect(result.passed).toBe(true);
      expect(result.raw_output_path && existsSync(result.raw_output_path)).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("fails command gates with nonzero exit code without throwing", async () => {
    const cwd = await tempDir("tedge-control-gate-fail-");
    try {
      const gate = createGate({ id: "fail", type: "command", command: nodeFailCommand(), timeout_sec: 10, required: true });
      const result = await gate.run(gateContext(cwd));

      expect(result.passed).toBe(false);
      expect(result.error).toBeNull();
      expect(result.summary).toContain("failed");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects shell metacharacters in command gates", async () => {
    const cwd = await tempDir("tedge-control-gate-metachar-");
    try {
      const gate = createGate({ id: "blocked", type: "command", command: `${nodePassCommand()} && ${nodeFailCommand()}`, timeout_sec: 10, required: true });
      const result = await gate.run(gateContext(cwd));

      expect(result.passed).toBe(false);
      expect(result.error).toContain("Shell command blocked");
      expect(result.error).toContain("metacharacters");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("checks file_exists gates", async () => {
    const cwd = await tempDir("tedge-control-file-exists-");
    try {
      await writeFile(path.join(cwd, "artifact.txt"), "ok\n", "utf8");
      const gate = createGate({ id: "artifact", type: "file_exists", path: "artifact.txt", timeout_sec: 10, required: true });
      const result = await gate.run(gateContext(cwd));

      expect(result.passed).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("checks diff_required gates from observed workspace state", async () => {
    const cwd = await tempDir("tedge-control-diff-");
    try {
      const baseline = await createWorkspaceSnapshot(cwd);
      await writeFile(path.join(cwd, "changed.txt"), "changed\n", "utf8");
      const observed = await observeWorkspace(cwd, baseline);
      const gate = createGate({ id: "diff_exists", type: "diff_required", timeout_sec: 10, required: true });
      const result = await gate.run(gateContext(cwd, observed));

      expect(result.passed).toBe(true);
      expect(result.summary).toContain("changed file");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("diff_required ignores preexisting dirty files when a run baseline exists", async () => {
    const cwd = await tempDir("tedge-control-baseline-diff-");
    try {
      await writeFile(path.join(cwd, "preexisting.txt"), "dirty before run\n", "utf8");
      const baseline = await createWorkspaceSnapshot(cwd);
      const unchanged = await observeWorkspace(cwd, baseline);

      expect(unchanged.files_changed).toEqual([]);
      expect(unchanged.diff_basis).toBe("run_baseline");

      await writeFile(path.join(cwd, "new_change.txt"), "new after run\n", "utf8");
      const changed = await observeWorkspace(cwd, baseline);

      expect(changed.files_changed).toEqual(["new_change.txt"]);
      expect(changed.diff_basis).toBe("run_baseline");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("git dirty file before run does not satisfy diff_required when baseline exists", async () => {
    const cwd = await tempDir("tedge-control-git-baseline-");
    try {
      await execa("git", ["init"], { cwd });
      await writeFile(path.join(cwd, "preexisting.txt"), "dirty before run\n", "utf8");
      const baseline = await createWorkspaceSnapshot(cwd);
      const observed = await observeWorkspace(cwd, baseline);
      const gate = createGate({ id: "diff_exists", type: "diff_required", timeout_sec: 10, required: true });
      const result = await gate.run(gateContext(cwd, observed));

      expect(observed.git_available).toBe(true);
      expect(observed.files_changed).toEqual([]);
      expect(result.passed).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("detects path changes outside allowed_paths", () => {
    expect(findAllowedPathViolations(["src/index.ts", "docs/readme.md"], ["src"])).toEqual(["docs/readme.md"]);
  });

  it("allows files inside allowed_paths", () => {
    expect(findAllowedPathViolations(["src/index.ts", "src/core/a.ts"], ["src"])).toEqual([]);
  });

  it("checker confidence 1.0 cannot override a failing command blocking check", async () => {
    const cwd = await tempDir("tedge-control-hard-blocks-");
    try {
      const goal = goalWithCondition("unit_tests_pass", "test");
      const evaluation: EvalSpec = {
        hard_gates: [{ id: "unit_tests_pass", type: "command", command: nodeFailCommand(), timeout_sec: 10, required: true }],
        soft_gates: [{ id: "checker", type: "checker_agent", timeout_sec: 10, required: false, threshold: 0.5 }],
        judge: { mode: "hard_plus_checker", checker_role: "reviewer", min_confidence: 0.5 },
        evidence_required: true
      };
      const result = await new EvaluationRunner().run({
        cwd,
        goal,
        evalSpec: evaluation,
        evidenceDir: path.join(cwd, "evidence"),
        iteration: 1,
        observed: await observeWorkspace(cwd)
      });

      expect(result.soft_gate_results[0].passed).toBe(true);
      expect(result.soft_gate_results[0].score).toBe(1);
      expect(result.all_hard_gates_passed).toBe(false);
      expect(result.converged).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("warns when no blocking check exists", async () => {
    const cwd = await tempDir("tedge-control-weak-");
    try {
      const result = await new EvaluationRunner().run({
        cwd,
        goal: goalWithCondition("manual_review", "manual"),
        evalSpec: {
          hard_gates: [],
          soft_gates: [{ id: "checker", type: "checker_agent", timeout_sec: 10, required: false, threshold: 0.5 }],
          judge: { mode: "hard_plus_checker", checker_role: "reviewer", min_confidence: 0.5 },
          evidence_required: true
        },
        evidenceDir: path.join(cwd, "evidence"),
        iteration: 1,
        observed: await observeWorkspace(cwd)
      });

      expect(result.warnings.join("\n")).toContain("weakly verifiable");
      expect(result.converged).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("Canopus Runtime ConvergencePolicy", () => {
  it("loop_stop_when_checker_confidence_blocks_convergence", () => {
    const evaluation = evaluationResultFixture({ confidence: 0.74 });

    expect(shouldConverge({
      loop: loopSpec({ maxIterations: 3, checkerConfidence: 0.75 }),
      evaluation,
      blockers: []
    })).toBe(false);
  });

  it("loop_stop_when_unresolved_blockers_blocks_convergence", () => {
    expect(shouldConverge({
      loop: loopSpec({ maxIterations: 3 }),
      evaluation: evaluationResultFixture(),
      blockers: ["modified path outside allowed_paths: docs/readme.md"]
    })).toBe(false);
  });

  it("loop_stop_when_required_conditions_blocks_convergence", () => {
    expect(shouldConverge({
      loop: loopSpec({ maxIterations: 3 }),
      evaluation: evaluationResultFixture({ requiredConditionsMet: false, missingConditions: ["unit_tests_pass"] }),
      blockers: []
    })).toBe(false);
  });

  it("evidence_required_blocks_convergence_without_hard_gate_evidence", () => {
    expect(shouldConverge({
      loop: loopSpec({ maxIterations: 3 }),
      evaluation: evaluationResultFixture({ requiredGateEvidenceComplete: false, missingEvidenceGateIds: ["unit_tests_pass"] }),
      blockers: []
    })).toBe(false);
  });

  it("evidence_collected_requires_required_gate_evidence", async () => {
    const cwd = await tempDir("tedge-control-required-evidence-");
    try {
      const result = await new EvaluationRunner().run({
        cwd,
        goal: goalWithCondition("evidence_collected", "evidence_collected"),
        evalSpec: {
          hard_gates: [],
          soft_gates: [{ id: "checker_only", type: "checker_agent", timeout_sec: 10, required: false, threshold: 0.5 }],
          judge: { mode: "hard_plus_checker", checker_role: "reviewer", min_confidence: 0.5 },
          evidence_required: true
        },
        evidenceDir: path.join(cwd, "evidence"),
        iteration: 1,
        observed: await observeWorkspace(cwd)
      });

      expect(result.satisfied_conditions).not.toContain("evidence_collected");
      expect(result.missing_conditions).toContain("evidence_collected");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("Canopus Runtime status store and ConvergenceEngine", () => {
  it("writes and reloads trace.jsonl, status.latest.json, and progress.md", async () => {
    const cwd = await tempDir("tedge-control-store-");
    try {
      const store = new StatusStore(cwd, "run_store");
      const status = minimalStatus("run_store");
      await store.writeStatus(status);

      expect(existsSync(store.tracePath)).toBe(true);
      expect(existsSync(store.latestPath)).toBe(true);
      expect(existsSync(store.progressPath)).toBe(true);
      expect((await store.readTrace())[0].run_id).toBe("run_store");
      expect((await store.readLatest()).decision.reason).toBe("initialized");
      expect(await readFile(store.progressPath, "utf8")).toContain("# Run status");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("stops on success after mock AgentBridge satisfies file and blocking check", async () => {
    const cwd = await tempDir("tedge-control-success-");
    try {
      const result = await new ReconciliationController().run({
        cwd,
        runId: "success_run",
        goal: goalWithFileArtifact(),
        evaluation: {
          hard_gates: [{ id: "result_exists", type: "file_exists", path: "result.md", timeout_sec: 10, required: true }],
          soft_gates: [],
          judge: { mode: "hard_only", checker_role: null, min_confidence: 0.5 },
          evidence_required: true
        },
        loop: loopSpec({ maxIterations: 3 })
      });

      expect(result.converged).toBe(true);
      expect(result.status.phase).toBe("converged");
      expect(result.status.iteration).toBe(1);
      expect(existsSync(path.join(cwd, ".runs", "success_run", "trace.jsonl"))).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("controller_writes_post_action_evaluation_status", async () => {
    const cwd = await runtimeFixtureCopy();
    try {
      try {
        await execa("npm", ["test"], { cwd });
        throw new Error("expected initial npm test to fail");
      } catch (error) {
        const failed = error as { stdout?: string; stderr?: string };
        expect(`${failed.stdout ?? ""}\n${failed.stderr ?? ""}`).toContain("AssertionError");
      }
      const document = requireRunnableControlPlaneDocument(await loadControlPlaneSpecDocument(path.join(cwd, "goal.yaml")));
      const result = await new ReconciliationController().run({
        cwd,
        runId: "runtime_bugfix",
        goal: document.goal,
        evaluation: document.evaluation,
        loop: document.loop,
        adapter: new ShellAgentAdapter("node fix-bug.mjs")
      });
      const store = new StatusStore(cwd, "runtime_bugfix");
      const trace = await store.readTrace();
      const latest = await store.readLatest();
      const progress = await readFile(store.progressPath, "utf8");
      const iteration1 = trace.find((status) => status.iteration === 1);
      const preLog = await readFile(path.join(store.evidenceDir(1), "pre_action", "unit_tests_pass.log"), "utf8");
      const postLog = await readFile(path.join(store.evidenceDir(1), "unit_tests_pass.log"), "utf8");

      expect(result.converged).toBe(true);
      expect(latest.phase).toBe("converged");
      expect(latest.iteration).toBe(1);
      expect(latest.evaluation_phase).toBe("post_action");
      expect(latest.observed_state.files_changed).toEqual(["index.js"]);
      expect(latest.diff.satisfied_conditions).toEqual(expect.arrayContaining([
        "unit_tests_pass",
        "diff_exists",
        "no_denied_path_modified",
        "evidence_collected"
      ]));
      expect(trace.length).toBe(2);
      expect(iteration1?.pre_action_gate_results?.find((gate) => gate.id === "unit_tests_pass")?.passed).toBe(false);
      expect(iteration1?.evidence.gate_results.find((gate) => gate.id === "unit_tests_pass")?.passed).toBe(true);
      expect(preLog).toContain("AssertionError");
      expect(postLog).toContain("unit test passed");
      expect(existsSync(path.join(store.evidenceDir(1), "gate_results.json"))).toBe(true);
      expect(existsSync(path.join(store.evidenceDir(1), "pre_gate_results.json"))).toBe(true);
      expect(existsSync(path.join(store.evidenceDir(1), "post_gate_results.json"))).toBe(true);
      expect(existsSync(path.join(store.evidenceDir(1), "changed_files.json"))).toBe(true);
      expect(existsSync(path.join(store.evidenceDir(1), "controller_decision.json"))).toBe(true);
      expect(iteration1?.desired_state_ref).toBe("goal:simple_bugfix_runtime");
      expect(iteration1?.diff).toBeDefined();
      expect(iteration1?.evidence.gate_results.length).toBeGreaterThan(0);
      expect(iteration1?.decision.reason).toBeTruthy();
      expect(progress).toContain("Phase: converged");
      expect(await readFile(path.join(cwd, "index.js"), "utf8")).toContain("return a + b;");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 40_000);

  it("rejects shell metacharacters in the shell actuator adapter", async () => {
    const cwd = await tempDir("tedge-control-adapter-metachar-");
    try {
      const adapter = new ShellAgentAdapter(`${nodePassCommand()} && ${nodeFailCommand()}`);
      const result = await adapter.act(actionInput(cwd));

      expect(result.status).toBe("failed");
      expect(result.error).toContain("Shell command blocked");
      expect(result.error).toContain("metacharacters");
      expect(result.commandsRun).toEqual([`${nodePassCommand()} && ${nodeFailCommand()}`]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("iteration_evidence_contains_pre_and_post_gate_results", async () => {
    const cwd = await runtimeFixtureCopy();
    try {
      const document = requireRunnableControlPlaneDocument(await loadControlPlaneSpecDocument(path.join(cwd, "goal.yaml")));
      await new ReconciliationController().run({
        cwd,
        runId: "runtime_evidence",
        goal: document.goal,
        evaluation: document.evaluation,
        loop: document.loop,
        adapter: new ShellAgentAdapter("node fix-bug.mjs")
      });
      const store = new StatusStore(cwd, "runtime_evidence");

      expect(existsSync(path.join(store.evidenceDir(1), "pre_gate_results.json"))).toBe(true);
      expect(existsSync(path.join(store.evidenceDir(1), "post_gate_results.json"))).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 40_000);

  it("stops on max_iterations_reached", async () => {
    const cwd = await tempDir("tedge-control-max-");
    try {
      const result = await new ReconciliationController().run({
        cwd,
        runId: "max_run",
        goal: goalWithCondition("unit_tests_pass", "test"),
        evaluation: failingEvaluation(),
        loop: loopSpec({ maxIterations: 3, noProgressRounds: 99, repeatedFailureRounds: 99 }),
        adapter: new NoopAgentAdapter()
      });

      expect(result.aborted).toBe(true);
      expect(result.status.decision.reason).toContain("max iterations reached");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("detects no progress rounds", async () => {
    const cwd = await tempDir("tedge-control-no-progress-");
    try {
      const result = await new ReconciliationController().run({
        cwd,
        runId: "no_progress_run",
        goal: goalWithCondition("unit_tests_pass", "test"),
        evaluation: failingEvaluation(),
        loop: loopSpec({ maxIterations: 5, noProgressRounds: 1, repeatedFailureRounds: 99 }),
        adapter: new NoopAgentAdapter()
      });

      expect(result.aborted).toBe(true);
      expect(result.status.iteration).toBe(2);
      expect(result.status.decision.reason).toContain("no progress");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("does_not_abort_before_first_repair_attempt", async () => {
    const cwd = await runtimeFixtureCopy();
    try {
      const document = requireRunnableControlPlaneDocument(await loadControlPlaneSpecDocument(path.join(cwd, "goal.yaml")));
      const result = await new ReconciliationController().run({
        cwd,
        runId: "first_repair_not_preblocked",
        goal: document.goal,
        evaluation: document.evaluation,
        loop: {
          ...document.loop,
          abort_when: {
            ...document.loop.abort_when,
            repeated_failure_rounds: 1
          }
        },
        adapter: new ShellAgentAdapter("node fix-bug.mjs")
      });

      expect(result.converged).toBe(true);
      expect(result.status.iteration).toBe(1);
      expect(await readFile(path.join(cwd, "index.js"), "utf8")).toContain("return a + b;");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 40_000);

  it("repeated_failure_counts_post_action_failures", async () => {
    const cwd = await tempDir("tedge-control-post-failure-");
    try {
      const result = await new ReconciliationController().run({
        cwd,
        runId: "post_failure_run",
        goal: goalWithCondition("unit_tests_pass", "test"),
        evaluation: failingEvaluation(),
        loop: loopSpec({ maxIterations: 3, noProgressRounds: 99, repeatedFailureRounds: 1 }),
        adapter: new NoopAgentAdapter()
      });

      expect(result.aborted).toBe(true);
      expect(result.status.iteration).toBe(1);
      expect(result.status.decision.reason).toContain("post-action");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("no_progress_uses_post_action_progress_key", async () => {
    const cwd = await tempDir("tedge-control-post-progress-");
    try {
      const result = await new ReconciliationController().run({
        cwd,
        runId: "post_progress_run",
        goal: goalWithCondition("unit_tests_pass", "test"),
        evaluation: failingEvaluation(),
        loop: loopSpec({ maxIterations: 4, noProgressRounds: 1, repeatedFailureRounds: 99 }),
        adapter: new NoopAgentAdapter()
      });

      expect(result.aborted).toBe(true);
      expect(result.status.iteration).toBe(2);
      expect(result.status.decision.reason).toContain("no progress");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("detects repeated blocking-check failures", async () => {
    const cwd = await tempDir("tedge-control-repeated-failure-");
    try {
      const result = await new ReconciliationController().run({
        cwd,
        runId: "repeated_failure_run",
        goal: goalWithCondition("unit_tests_pass", "test"),
        evaluation: failingEvaluation(),
        loop: loopSpec({ maxIterations: 5, noProgressRounds: 99, repeatedFailureRounds: 2 }),
        adapter: new NoopAgentAdapter()
      });

      expect(result.aborted).toBe(true);
      expect(result.status.decision.reason).toContain("blocking check always failing");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("detects modified denied paths", async () => {
    const cwd = await tempDir("tedge-control-denied-");
    try {
      const result = await new ReconciliationController().run({
        cwd,
        runId: "denied_run",
        goal: {
          ...goalWithCondition("diff_exists", "diff_required"),
          constraints: {
            allowed_paths: ["."],
            denied_paths: ["blocked.txt"],
            max_files_changed: 10,
            max_iterations: 3,
            require_human_review: false
          }
        },
        evaluation: {
          hard_gates: [{ id: "diff_exists", type: "diff_required", timeout_sec: 10, required: true }],
          soft_gates: [],
          judge: { mode: "hard_only", checker_role: null, min_confidence: 0.5 },
          evidence_required: true
        },
        loop: loopSpec({ maxIterations: 3 }),
        adapter: new WriteFilesAdapter(["blocked.txt"])
      });

      expect(result.aborted).toBe(true);
      expect(result.status.decision.reason).toContain("modified denied path");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("detects_path_outside_allowed_paths", async () => {
    const cwd = await tempDir("tedge-control-allowed-");
    try {
      const result = await new ReconciliationController().run({
        cwd,
        runId: "allowed_run",
        goal: {
          ...goalWithCondition("diff_exists", "diff_required"),
          constraints: {
            allowed_paths: ["src"],
            denied_paths: [".git", ".runs"],
            max_files_changed: 10,
            max_iterations: 3,
            require_human_review: false
          }
        },
        evaluation: {
          hard_gates: [{ id: "diff_exists", type: "diff_required", timeout_sec: 10, required: true }],
          soft_gates: [],
          judge: { mode: "hard_only", checker_role: null, min_confidence: 0.5 },
          evidence_required: true
        },
        loop: loopSpec({ maxIterations: 3 }),
        adapter: new WriteFilesAdapter(["docs/readme.md"])
      });

      expect(result.aborted).toBe(true);
      expect(result.status.decision.reason).toContain("modified path outside allowed_paths");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("denied_paths_override_allowed_paths", async () => {
    const cwd = await tempDir("tedge-control-denied-allowed-");
    try {
      const result = await new ReconciliationController().run({
        cwd,
        runId: "denied_allowed_run",
        goal: {
          ...goalWithCondition("diff_exists", "diff_required"),
          constraints: {
            allowed_paths: ["."],
            denied_paths: ["src/secret.txt"],
            max_files_changed: 10,
            max_iterations: 3,
            require_human_review: false
          }
        },
        evaluation: {
          hard_gates: [{ id: "diff_exists", type: "diff_required", timeout_sec: 10, required: true }],
          soft_gates: [],
          judge: { mode: "hard_only", checker_role: null, min_confidence: 0.5 },
          evidence_required: true
        },
        loop: loopSpec({ maxIterations: 3 }),
        adapter: new WriteFilesAdapter(["src/secret.txt"])
      });

      expect(result.aborted).toBe(true);
      expect(result.status.decision.reason).toContain("modified denied path");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("detects too many changed files", async () => {
    const cwd = await tempDir("tedge-control-too-many-");
    try {
      const result = await new ReconciliationController().run({
        cwd,
        runId: "too_many_run",
        goal: {
          ...goalWithCondition("diff_exists", "diff_required"),
          constraints: {
            allowed_paths: ["."],
            denied_paths: [".git", ".runs"],
            max_files_changed: 1,
            max_iterations: 3,
            require_human_review: false
          }
        },
        evaluation: {
          hard_gates: [{ id: "diff_exists", type: "diff_required", timeout_sec: 10, required: true }],
          soft_gates: [],
          judge: { mode: "hard_only", checker_role: null, min_confidence: 0.5 },
          evidence_required: true
        },
        loop: loopSpec({ maxIterations: 3 }),
        adapter: new WriteFilesAdapter(["a.txt", "b.txt"])
      });

      expect(result.aborted).toBe(true);
      expect(result.status.decision.reason).toContain("too many files changed");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("keeps checker disagreement with failed blocking check in status blockers", async () => {
    const cwd = await tempDir("tedge-control-checker-disagree-");
    try {
      const result = await new ReconciliationController().run({
        cwd,
        runId: "checker_disagree_run",
        goal: goalWithCondition("unit_tests_pass", "test"),
        evaluation: {
          ...failingEvaluation(),
          soft_gates: [{ id: "checker", type: "checker_agent", timeout_sec: 10, required: false, threshold: 0.5 }],
          judge: { mode: "hard_plus_checker", checker_role: "reviewer", min_confidence: 0.5 }
        },
        loop: loopSpec({ maxIterations: 3, noProgressRounds: 99, repeatedFailureRounds: 99 }),
        adapter: new NoopAgentAdapter()
      });
      const trace = await new StatusStore(cwd, "checker_disagree_run").readTrace();
      const activeFailure = trace.find((status) => status.iteration > 0 && status.decision.should_continue);

      expect(result.status.phase).not.toBe("converged");
      expect(result.status.decision.reason).toMatch(/blocking check|max iterations/);
      expect(activeFailure?.decision.reason).toContain("blocking checks still failing after AgentBridge action");
      expect(activeFailure?.observed_state.unresolved_blockers.join("\n")).toContain("advisory checks cannot override blocking checks");
      expect(activeFailure?.evidence.gate_results.find((gate) => gate.id === "checker")?.score).toBe(1);
      expect(activeFailure?.evidence.gate_results.find((gate) => gate.id === "unit_tests_pass")?.passed).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("runs Sirius Council as a real Canopus AgentBridge without bypassing blocking checks", async () => {
    const cwd = await tempDir("tedge-control-sirius-actuator-");
    try {
      const config = loadConfigWithSource(process.cwd(), {
        configPath: path.join(process.cwd(), "examples", "configs", "sirius-codex-deepseek-mimo.mock.yaml")
      }).config;
      const adapter = new SiriusCouncilActuatorAdapter(config, {
        fixtureMode: true,
        accessMode: "full",
        approvePatch: true,
        approveShell: true
      });
      const observed = await observeWorkspace(cwd);
      const goal = {
        ...goalWithCondition("unit_tests_pass", "test"),
        description: "Rebuild this JS CLI app in Rust using Sirius Council governance."
      };
      const action = await adapter.act({
        cwd,
        goal,
        iteration: 1,
        observed,
        delta: computeDesiredStateDiff(goal),
        evidenceDir: path.join(cwd, "evidence", "iteration_001")
      });

      expect(action.status).toBe("success");
      expect(action.summary).toContain("Sirius Council AgentBridge completed");
      expect(existsSync(path.join(cwd, "evidence", "iteration_001", "sirius_council_action.json"))).toBe(true);
      expect(existsSync(path.join(cwd, "evidence", "iteration_001", "sirius_council_events.jsonl"))).toBe(true);

      const result = await new ReconciliationController().run({
        cwd,
        runId: "sirius_gate_authority",
        goal,
        evaluation: failingEvaluation(),
        loop: loopSpec({ maxIterations: 2, noProgressRounds: 99, repeatedFailureRounds: 99 }),
        adapter
      });
      const trace = await new StatusStore(cwd, "sirius_gate_authority").readTrace();

      expect(result.converged).toBe(false);
      expect(result.status.phase).toBe("aborted");
      expect(result.status.decision.reason).toContain("max iterations");
      expect(trace.some((status) => status.evidence.artifacts.some((artifact) => String((artifact as { path?: unknown }).path ?? "").includes("sirius_council_action.json")))).toBe(true);
      expect(trace.some((status) => status.evidence.gate_results.some((gate) => gate.id === "unit_tests_pass" && !gate.passed))).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 60_000);

  it("converts old Objective Contract to structured GoalSpec", () => {
    const goal = objectiveContractToGoalSpec(objectiveContractFixture());

    expect(goal.id).toBe("contract_1");
    expect(goal.desired_state.success_conditions[0].required).toBe(true);
    expect(goal.desired_state.success_conditions[0].description).toContain("tests pass");
    expect(goal.constraints.require_human_review).toBe(false);
  });
});

class WriteFilesAdapter implements ControlPlaneAgentAdapter {
  readonly id = "write-files";

  constructor(private readonly files: string[]) {}

  async act(input: ControlPlaneActionInput): Promise<ControlPlaneActionResult> {
    for (const file of this.files) {
      const target = path.join(input.cwd, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `iteration ${input.iteration}\n`, "utf8");
    }
    return {
      status: "success",
      summary: `wrote ${this.files.length} file(s)`,
      changedFiles: this.files,
      commandsRun: [],
      artifacts: this.files.map((file) => ({ path: file, kind: "file" }))
    };
  }
}

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function runtimeFixtureCopy(): Promise<string> {
  const target = await tempDir("tedge-control-runtime-");
  const source = path.join(process.cwd(), "examples", "control_plane", "simple_bugfix_runtime");
  await cp(source, target, { recursive: true });
  await rm(path.join(target, ".runs"), { recursive: true, force: true });
  return target;
}

function nodePassCommand(): string {
  return 'node -e "process.exit(0)"';
}

function nodeFailCommand(): string {
  return 'node -e "process.exit(1)"';
}

function gateContext(cwd: string, observed = { files_changed: [], changed_file_count: 0, git_available: false }) {
  const goal = goalWithCondition("unit_tests_pass", "test");
  return {
    cwd,
    goal,
    evalSpec: failingEvaluation(),
    evidenceDir: path.join(cwd, "evidence"),
    iteration: 1,
    observed
  };
}

function actionInput(cwd: string): ControlPlaneActionInput {
  const goal = goalWithCondition("unit_tests_pass", "test");
  return {
    cwd,
    goal,
    iteration: 1,
    observed: { files_changed: [], changed_file_count: 0, git_available: false },
    delta: {
      missing_conditions: ["unit_tests_pass"],
      satisfied_conditions: [],
      regressions: [],
      unknown_conditions: []
    },
    evidenceDir: path.join(cwd, "evidence")
  };
}

function goalWithCondition(id: string, type: GoalSpec["desired_state"]["success_conditions"][number]["type"]): GoalSpec {
  return {
    id: "goal",
    title: "Structured control goal",
    description: "A structured goal that cannot collapse into a free-form prompt.",
    mode: "coding",
    desired_state: {
      summary: "Required conditions are satisfied.",
      success_conditions: [{ id, description: id, type, required: true }]
    },
    constraints: {
      allowed_paths: ["."],
      denied_paths: [".git", ".runs"],
      max_files_changed: 10,
      max_iterations: 3,
      require_human_review: false
    },
    artifacts: { required: [] }
  };
}

function goalWithFileArtifact(): GoalSpec {
  return {
    ...goalWithCondition("result_exists", "file_exists"),
    artifacts: {
      required: [{ path: "result.md", description: "result artifact" }]
    }
  };
}

function failingEvaluation(): EvalSpec {
  return {
    hard_gates: [{ id: "unit_tests_pass", type: "command", command: nodeFailCommand(), timeout_sec: 10, required: true }],
    soft_gates: [],
    judge: { mode: "hard_only", checker_role: null, min_confidence: 0.5 },
    evidence_required: true
  };
}

function loopSpec(options: { maxIterations: number; noProgressRounds?: number; repeatedFailureRounds?: number; checkerConfidence?: number | null }): LoopSpec {
  return {
    max_iterations: options.maxIterations,
    strategy: "reconcile",
    one_item_per_loop: true,
    fresh_context_each_iteration: true,
    retry_policy: { type: "none", base_delay_sec: 0, max_delay_sec: 0 },
    stop_when: {
      all_hard_gates_pass: true,
      all_required_conditions_met: true,
      checker_confidence_above: options.checkerConfidence ?? null,
      no_unresolved_blockers: true
    },
    abort_when: {
      max_iterations_reached: true,
      no_progress_rounds: options.noProgressRounds ?? 99,
      repeated_failure_rounds: options.repeatedFailureRounds ?? 99,
      budget_exhausted: true
    }
  };
}

function evaluationResultFixture(options: {
  allHardPassed?: boolean;
  requiredConditionsMet?: boolean;
  requiredGateEvidenceComplete?: boolean;
  missingConditions?: string[];
  missingEvidenceGateIds?: string[];
  confidence?: number;
} = {}): EvaluationResult {
  const allHardPassed = options.allHardPassed ?? true;
  const requiredConditionsMet = options.requiredConditionsMet ?? true;
  const requiredGateEvidenceComplete = options.requiredGateEvidenceComplete ?? true;
  const missingConditions = options.missingConditions ?? [];
  const missingEvidenceGateIds = options.missingEvidenceGateIds ?? [];
  const confidence = options.confidence ?? 1;
  return {
    hard_gate_results: [{
      id: "unit_tests_pass",
      type: "test",
      required: true,
      passed: allHardPassed,
      score: allHardPassed ? 1 : 0,
      summary: allHardPassed ? "passed" : "failed",
      evidence_path: requiredGateEvidenceComplete ? "unit_tests_pass.log" : null,
      raw_output_path: requiredGateEvidenceComplete ? "unit_tests_pass.log" : null,
      error: allHardPassed ? null : "failed"
    }],
    soft_gate_results: [],
    all_hard_gates_passed: allHardPassed,
    required_conditions_met: requiredConditionsMet,
    required_gate_evidence_complete: requiredGateEvidenceComplete,
    missing_evidence_gate_ids: missingEvidenceGateIds,
    satisfied_conditions: requiredConditionsMet ? ["unit_tests_pass"] : [],
    missing_conditions: missingConditions,
    regressions: [],
    warnings: [],
    confidence,
    converged: allHardPassed && requiredConditionsMet && requiredGateEvidenceComplete && confidence >= 1
  };
}

function minimalStatus(runId: string) {
  return {
    run_id: runId,
    goal_id: "goal",
    iteration: 0,
    phase: "initialized" as const,
    observed_state: {
      files_changed: [],
      tests_run: [],
      commands_run: [],
      current_errors: [],
      unresolved_blockers: []
    },
    desired_state_ref: "goal:goal",
    diff: {
      missing_conditions: ["unit_tests_pass"],
      satisfied_conditions: [],
      regressions: [],
      unknown_conditions: []
    },
    evidence: {
      artifacts: [],
      logs: [],
      gate_results: []
    },
    decision: {
      should_continue: true,
      reason: "initialized",
      next_action: "observe",
      confidence: null
    },
    timestamps: {
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  };
}

function validGoalYaml(options: {
  conditionType?: string;
  conditionId?: string;
  artifactPath?: string;
  hardGateId?: string;
  hardGateType?: string;
  hardGatePath?: string;
  command?: string;
  omitHardGates?: boolean;
} = {}): string {
  const conditionType = options.conditionType ?? "test";
  const conditionId = options.conditionId ?? "unit_tests_pass";
  const hardGateId = options.hardGateId ?? conditionId;
  const hardGateType = options.hardGateType ?? "command";
  const command = options.command === undefined ? nodePassCommand() : options.command;
  const artifact = options.artifactPath
    ? [
        "  artifacts:",
        "    required:",
        `      - path: ${options.artifactPath}`,
        "        description: required artifact"
      ]
    : [
        "  artifacts:",
        "    required: []"
      ];
  const hardGateLines = hardGateType === "file_exists"
    ? [
        `    - id: ${hardGateId}`,
        "      type: file_exists",
        `      path: ${options.hardGatePath ?? options.artifactPath ?? "result.md"}`,
        "      timeout_sec: 10",
        "      required: true"
      ]
    : [
        `    - id: ${hardGateId}`,
        `      type: ${hardGateType}`,
        command !== undefined ? `      command: ${JSON.stringify(command)}` : "",
        "      timeout_sec: 10",
        "      required: true"
      ].filter(Boolean);
  const hardGateSection = options.omitHardGates
    ? ["  hard_gates: []"]
    : ["  hard_gates:", ...hardGateLines];
  return [
    "goal:",
    "  id: simple_bugfix",
    "  title: Fix failing unit test",
    "  description: Modify the project until the unit test passes.",
    "  mode: coding",
    "  desired_state:",
    "    summary: All tests pass and required artifacts exist.",
    "    success_conditions:",
    `      - id: ${conditionId}`,
    "        description: Required condition must pass.",
    `        type: ${conditionType}`,
    "        required: true",
    ...artifact,
    "  constraints:",
    "    allowed_paths: ['.']",
    "    denied_paths: ['.git', '.runs']",
    "    max_files_changed: 10",
    "    max_iterations: 5",
    "    require_human_review: false",
    "evaluation:",
    ...hardGateSection,
    "  soft_gates:",
    "    - id: checker_review",
    "      type: checker_agent",
    "      required: false",
    "      threshold: 0.75",
    "      timeout_sec: 10",
    "  judge:",
    "    mode: hard_plus_checker",
    "    checker_role: reviewer",
    "    min_confidence: 0.75",
    "  evidence_required: true",
    "loop:",
    "  max_iterations: 5",
    "  strategy: reconcile",
    "  one_item_per_loop: true",
    "  fresh_context_each_iteration: true",
    "  retry_policy:",
    "    type: none",
    "    base_delay_sec: 0",
    "    max_delay_sec: 0",
    "  stop_when:",
    "    all_hard_gates_pass: true",
    "    all_required_conditions_met: true",
    "    checker_confidence_above: 0.75",
    "    no_unresolved_blockers: true",
    "  abort_when:",
    "    max_iterations_reached: true",
    "    no_progress_rounds: 2",
    "    repeated_failure_rounds: 3",
    "    budget_exhausted: true",
    ""
  ].join("\n");
}

function canopusObjectiveYaml(): string {
  return [
    "objective:",
    "  id: simple_bugfix",
    "  title: Fix failing unit test",
    "  description: Modify the project until the unit test passes.",
    "  mode: coding",
    "  target_state:",
    "    summary: All required blocking checks pass.",
    "    success_conditions:",
    "      - id: unit_tests_pass",
    "        description: Unit tests must pass.",
    "        type: test",
    "        required: true",
    "  constraints:",
    "    allowed_paths: ['.']",
    "    denied_paths: ['.git', '.runs']",
    "    max_files_changed: 10",
    "    max_iterations: 3",
    "    require_human_review: false",
    "  artifacts:",
    "    required: []",
    "acceptance:",
    "  blocking_checks:",
    "    - id: unit_tests_pass",
    "      type: command",
    `      command: '${nodePassCommand()}'`,
    "      timeout_sec: 10",
    "      required: true",
    "  advisory_checks:",
    "    - id: checker_review",
    "      type: checker_agent",
    "      timeout_sec: 10",
    "      required: false",
    "      threshold: 0.75",
    "  judge:",
    "    mode: hard_plus_checker",
    "    reviewer_role: reviewer",
    "    min_confidence: 0.75",
    "  evidence_required: true",
    "convergence:",
    "  max_iterations: 3",
    "  strategy: reconcile",
    "  one_item_per_loop: true",
    "  fresh_context_each_iteration: true",
    "  retry_policy:",
    "    type: none",
    "    base_delay_sec: 0",
    "    max_delay_sec: 0",
    "  stop_when:",
    "    all_hard_gates_pass: true",
    "    all_required_conditions_met: true",
    "    checker_confidence_above: 0.75",
    "    no_unresolved_blockers: true",
    "  abort_when:",
    "    max_iterations_reached: true",
    "    no_progress_rounds: 2",
    "    repeated_failure_rounds: 3",
    "    budget_exhausted: true",
    ""
  ].join("\n");
}

function objectiveContractFixture(): ObjectiveContractV1 {
  return {
    schemaVersion: "objective-contract/v1",
    contractId: "contract_1",
    createdAt: new Date().toISOString(),
    goal: "fix tests",
    normalizedGoal: "fix tests",
    scenarioType: "coding",
    taskType: "bugfix",
    workflowKind: "patch",
    localObjective: "Make tests pass",
    userScenario: {
      inferredUserIntent: "bugfix",
      expectedDeliverable: "patch",
      interactionMode: "code_change",
      ambiguityLevel: "low"
    },
    successCriteria: ["tests pass"],
    failureCriteria: ["tests fail"],
    requiredEvidence: ["test output"],
    allowedPhases: ["planning", "coding", "verification"],
    allowedRoles: ["planner", "coder_a", "reviewer"],
    allowedTools: ["patch", "shell"],
    forbiddenActions: [],
    riskLevel: "low",
    reasoningSensitivity: "low",
    budget: {
      maxSteps: 3,
      maxRepairRounds: 1,
      maxShellRuns: 2,
      maxToolCalls: 5
    },
    uncertaintyPolicy: {
      whenToAskUser: [],
      whenToFallback: [],
      whenToProceedWithAssumption: [],
      whenToStop: []
    },
    stopCondition: {
      success: ["tests pass"],
      partial: [],
      failure: ["tests fail"],
      unsafe: []
    },
    fallbackPolicy: {
      plannerFallback: "stop",
      executorFallback: "stop",
      verifierFallback: "stop",
      userEscalation: "ask"
    },
    verificationRubric: {
      requiredCommands: ["npm test"],
      requiredArtifacts: [],
      evidenceChecks: ["test output"],
      reviewerChecks: [],
      judgeChecks: []
    },
    traceHints: {
      similarTraceIds: [],
      reusedLessons: [],
      avoidedFailurePatterns: []
    },
    source: "native",
    confidence: 0.8
  };
}
