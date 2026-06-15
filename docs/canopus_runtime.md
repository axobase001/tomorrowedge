# Canopus Runtime

TomorrowEdge 1.6 **Canopus** is **The Convergence Runtime Release**.

Canopus adds a convergence layer inside TomorrowEdge's existing local
orchestration, governance, and strategy-evolution runtime for heterogeneous
Coding Agents. It is a capability layer, not a replacement name for the whole
project.

The rule is simple: agents do not finish because they claim completion. A run
must satisfy an ObjectiveContract, pass an AcceptanceMatrix, leave evidence,
update RunState, and respect a bounded ConvergencePolicy.

Current status: Canopus ships a working convergence runtime with mock, noop,
shell, and Sirius Council AgentBridge paths. AgentBridge adapters can propose
or perform work, but they do not decide completion. Blocking acceptance checks
remain authoritative.

```text
ObjectiveContract + AcceptanceMatrix
        |
        v
ConvergenceEngine
        |
        v
AgentBridge / worker adapter
        |
        v
AcceptanceRunner
        |
        v
RunState / Trace Ledger / Evidence
        |
        v
Next iteration / Stop
```

## Why This Exists

The hard problem is not only whether an LLM can produce a plausible patch. The
hard problem is whether a system can keep unreliable agents pointed at a
verifiable software-engineering objective.

Canopus makes that runtime cycle explicit:

```text
observe -> pre-acceptance -> act -> observe -> post-acceptance -> write RunState -> decide next loop
```

This is not a prompt wrapper. The objective is structured, acceptance is
explicit, evidence is persisted, and stop decisions are bounded.

## Public Primitives

| Canopus primitive | Meaning |
| --- | --- |
| ObjectiveContract / CanopusObjective | Structured target definition, success conditions, constraints, and required artifacts. It must not collapse into a prompt. |
| AcceptanceMatrix | Blocking and advisory verification checks. Blocking checks have veto power. |
| ConvergencePolicy | Bounded execution policy: max iterations, no-progress detection, repeated-failure detection, and budget abort semantics. |
| RunState / TraceState | Persisted observed state, objective delta, evidence, decision, and timestamps for every loop. |
| EvidenceGate | Evidence requirements for checks, artifacts, logs, diffs, and review signals. |
| Trace Ledger / RunLedger | Durable `.runs/<run_id>/trace.jsonl`, `status.latest.json`, `progress.md`, and per-iteration evidence artifacts. |
| ConvergenceEngine | The runtime loop that observes, accepts, delegates, re-observes, writes state, and decides whether to continue. |
| AgentBridge | Worker-adapter layer for mock, noop, shell, Sirius Council, and future external agent paths. |

## Compatibility Names

Canopus v1.6 keeps the existing CLI and schema fields as compatibility aliases.
This avoids breaking scripts while the public vocabulary moves to convergence
runtime naming.

| Earlier control-plane term | Canopus public term |
| --- | --- |
| Agent Control Plane | Canopus convergence layer / Canopus Runtime |
| GoalSpec | ObjectiveContract / CanopusObjective |
| EvalSpec | AcceptanceMatrix |
| LoopSpec | ConvergencePolicy |
| StatusSpec | RunState / TraceState |
| ReconciliationController | ConvergenceEngine |
| EvaluationRunner | AcceptanceRunner |
| StatusStore | TraceStateStore / RunLedger |
| DesiredStateDiff | ObjectiveDelta |
| hard_gate | blocking_check |
| soft_gate | advisory_check |
| checker_agent | reviewer_role / review_agent |
| actuator | AgentBridge / worker_adapter |

The primary command is:

```bash
tedge canopus init
tedge canopus validate goal.yaml
tedge canopus run goal.yaml
tedge canopus status
tedge canopus report
```

`tedge control` remains the v1.6 compatibility alias for the same Canopus
Runtime commands and prints a deprecation warning on stderr. The legacy
`goal/evaluation/loop` schema remains supported for v1.6 compatibility. New
examples use `objective/acceptance/convergence`.

## Runtime Acceptance Demo

From a source checkout, run the real hard-gate bugfix runtime demo:

```bash
npm run dev -- canopus validate examples/canopus/simple_bugfix_runtime/objective.yaml
npm run dev -- canopus run examples/canopus/simple_bugfix_runtime/objective.yaml \
  --cwd examples/canopus/simple_bugfix_runtime \
  --adapter shell \
  --action-command "node fix-bug.mjs" \
  --run-id simple_bugfix_runtime
npm run dev -- canopus status --cwd examples/canopus/simple_bugfix_runtime --run-id simple_bugfix_runtime
npm run dev -- canopus report --cwd examples/canopus/simple_bugfix_runtime --run-id simple_bugfix_runtime
```

`examples/canopus/simple_bugfix_runtime` is the public Canopus runtime
acceptance fixture. It starts from a real failing `npm test`, records
pre-action evidence, lets the shell AgentBridge fix `index.js`, and converges
only after the post-action blocking check passes.

The old `examples/control_plane/*/goal.yaml` fixtures remain as legacy schema
compatibility coverage. The old mock-only artifact demo is
`examples/control_plane/mock_artifact`. It is useful smoke coverage, but it is
not proof of runtime convergence.

## Sirius Council Bridge

Run the same convergence layer through the Sirius Council AgentBridge:

```bash
npm run dev -- canopus run examples/canopus/simple_bugfix_runtime/objective.yaml \
  --cwd examples/canopus/simple_bugfix_runtime \
  --adapter sirius-council \
  --fixture-mode \
  --config examples/configs/sirius-codex-deepseek-mimo.mock.yaml \
  --access-mode full \
  --approve-patch \
  --approve-shell \
  --run-id canopus_sirius_control
```

The Sirius Council bridge routes one Canopus action through Chief Agent
planning, Council moves, TaskGraph ownership, delegated execution, mutation,
and Chief final review. The convergence decision still comes back to the
AcceptanceMatrix.

## Evidence Layout

A Canopus run writes:

```text
.runs/<run_id>/
  trace.jsonl
  status.latest.json
  progress.md
  evidence/
    iteration_001/
      pre_action/
        unit_tests_pass.log
        checker_review.json
        gate_results.json
      unit_tests_pass.log
      diff_exists.json
      checker_review.json
      pre_gate_results.json
      post_gate_results.json
      gate_results.json
      changed_files.json
      controller_decision.json
```

`status.latest.json` uses post-action acceptance results for convergence
decisions and includes `pre_action_gate_results` for audit. That prevents stale
pre-action failures from being reported as final status after an AgentBridge
has already modified the workspace.

## Acceptance Semantics

Supported v1.6 check classes:

- command/test/lint/typecheck/static-analysis blocking checks
- file-exists checks
- diff-required checks
- no-regression checks
- review-agent advisory checks

Rules:

- Required blocking checks must pass before convergence.
- Advisory checks can affect confidence but cannot replace real verification.
- A reviewer role cannot declare completion when tests fail.
- When evidence is required, required blocking checks must leave auditable
  evidence paths such as command logs or gate JSON artifacts.
- If no blocking check exists, the runtime emits a weak-verification warning.
- Check exceptions become failed acceptance results instead of uncaught errors.
- ConvergencePolicy stop conditions are executable policy, not documentation:
  convergence checks required blocking checks, required success conditions,
  blocking-check evidence, reviewer confidence, and unresolved blockers.
- Diff-required checks use a run-baseline snapshot when available, so
  preexisting dirty files do not count as progress made by the current run.
- Allowed paths, denied paths, and changed-file limits are enforced against
  post-action changed files before convergence.

## Failure Modes

The ConvergenceEngine records failure or abort reasons in RunState:

- `max_iterations_reached`
- `no_progress_rounds`
- `repeated_failure_rounds`
- `hard_gate_always_failing`
- `checker_disagrees_with_hard_gate`
- `weak_verification_warning`
- `modified_denied_path`
- `modified_outside_allowed_paths`
- `too_many_files_changed`
- `missing_required_evidence`

Some reason strings keep older compatibility labels such as `hard_gate` during
the v1.6 transition. The public meaning is a failed blocking acceptance check.

## Relationship To Existing TomorrowEdge Runtime

Canopus is additive. It does not replace Objective Contract, TaskGraph,
RoleGraph, EvidenceGate, BudgetGate, Debate v2, Strategy Memory, or Trace
Ledger.

Integration points:

- Existing Objective Contracts can be converted into Canopus objectives.
- Sirius Council can act as an AgentBridge while the AcceptanceMatrix remains
  authoritative.
- EvidenceGate and BudgetGate can feed Canopus evidence and convergence policy.
- Trace Ledger records every RunState loop.
- Strategy Memory can later read status and failure patterns.

## Appendix: Relation To Control Systems And Operator-Style Loops

Canopus shares engineering intuitions with control systems and operator-style
loops: desired state, observed state, reconciliation, and durable status.

That analogy is useful, but it is not the product headline. TomorrowEdge's own
public primitives are ObjectiveContract, AcceptanceMatrix, EvidenceGate, Trace
Ledger, ConvergenceEngine, and AgentBridge.

## Limitations

- No formal convergence guarantee yet.
- Review agents can be wrong.
- Blocking checks are only as good as the configured tests and commands.
- Human review is still required for high-risk changes.
- The Sirius Council AgentBridge is available, but final convergence is still
  controlled by the configured AcceptanceMatrix. A successful Council action
  cannot override a failing blocking check.
