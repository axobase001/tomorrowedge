# Error-Loop Memory Research Notes

TomorrowEdge treats failure memory as a local engineering aid, not as proof that
an agent has learned in the human sense. The current implementation stores
compact failure records from saved sessions and exposes them through:

```bash
tedge memory failures
tedge memory show <failure-id>
tedge memory explain "task description"
tedge experiment error-loop --ablation memory_on,memory_off
tedge experiment error-loop --ablation memory_off,success_memory_only,failure_memory_only,random_memory_control
```

Each failure record keeps a task fingerprint, a short redacted goal preview,
a failure class, a correction strategy, confidence, recurrence count, artifact
refs, project scope, source session IDs, and first/last seen timestamps. It
intentionally avoids raw stdout, stderr, diffs, provider payloads, and secrets.

Each correction strategy is scoped. Records include the wrong assumption,
corrected rule, applicability signals, counterexamples, validation command, and
`correctionStatus` (`verified`, `partial`, or `unverified`). Unverified lessons
remain visible for audit but should not be interpreted as proven fixes.

Repeated matching failures are merged by stable failure signature and project
scope. This preserves recurrence evidence without letting a hot loop flood the
memory file with duplicate rows.

## Deterministic Export Bundle

`tedge experiment error-loop` runs a small no-key fixture experiment and writes a
research-friendly bundle:

- `manifest.json`
- `trials.jsonl`
- `memory_records.jsonl`
- `retrieval_decisions.jsonl`
- `metrics.json`
- `report.md`

Each trial includes `memoryUpdateStatus`. This field separates workflow failure
or repair success from actual memory writes:

- `written`
- `skipped_no_failure`
- `skipped_low_confidence`
- `skipped_privacy`
- `skipped_ablation`
- `skipped_duplicate`

Reports must not claim the system learned from a failure unless
`memoryUpdateStatus` is `written`, or unless a skipped reason is explicitly
audited.

The harness supports explicit ablation arms:

- `memory_on`: write, retrieve, and inject failure memory plus success-memory
  route/test hints.
- `memory_off`: disable strategy and failure-memory behavior.
- `write_only`: write failure records but do not retrieve or inject them.
- `retrieve_only`: retrieve/inject existing failure records but do not write new
  failure records.
- `success_memory_only`: keep success-memory route/test hints while disabling
  failure correction injection and failure writes.
- `failure_memory_only`: write, retrieve, and inject failure memories while
  disabling success-memory route/test hints.
- `random_memory_control`: failure-memory loop with deterministic
  `random_control` retrieval policy.

`manifest.json` records `ablationSettings` for every arm, so hidden defaults do
not silently mix write, retrieval, and injection modes.

Normal project runs do not write failure-memory records by default. The
experiment harness opts in with `failure_memory.enabled: true` and marks records
as `storage_scope: experiment`, so research memory stays isolated from ordinary
project memory unless the user explicitly enables it.

`metrics.json` also separates:

- `memoryWritten`: new memory records created
- `memoryOccurrences`: selected or updated failure records observed in trials
- `suspectedNegativeTransfer`: trials where retrieved memory was available but
  the workflow still did not complete
- `recoveryAttemptsAfterFirstFailureTotal` and
  `averageRecoveryAttemptsAfterFirstFailure`: how much repair/execution happened
  after the first failed validation
- `repeatedSameClassErrorRate`: repeated same-class error signal from repair
  policy or recurring failure memory
- `validationPassRate`: share of trials with at least one passing verifier
- `transferTaskPassRate`: exported as `null` until a transfer split exists
- `averageCostToRecoveryUsd` and `averageTimeToRecoveryMs`: cost/time over
  completed recoveries when measured
- `memoryRetrievalPrecision`: selected retrievals over selected plus rejected
  retrieval records
- `harmfulRetrievalRate`: retrieved-memory trials that still did not complete
- `repairSuccessAfterRetrievalRate`: repair-context retrievals followed by
  successful validation

These fields are intentionally conservative. They support audit and ablation;
they do not prove causal improvement.

## Lifecycle and Retrieval Guards

Failure memories use a v2 lifecycle envelope:

- `failureSignature`: stable hash of failure class, task/risk shape, verifier,
  touched files, and redacted error signature
- `memoryScope`: project fingerprint plus dependency-lock hash when available
- `firstSeen` / `lastSeen`: recurrence window
- `recurrenceCount`: number of merged observations
- `sourceSessionIds`: sessions that produced the evidence
- `stale` / `staleReason`: computed read-time lifecycle status

Retrieval excludes stale memories by default. `tedge memory explain` still lists
stale records as rejected evidence with a reason such as `memory TTL expired` or
`project scope changed`, so negative transfer decisions remain inspectable.
Use `tedge memory failures --include-stale` or
`tedge memory show <id> --include-stale` when auditing lifecycle decisions.
Among otherwise similar records, verified correction lessons receive a stronger
retrieval score than partial or unverified lessons.

When strategy memory is enabled, retrieval can influence four workflow points:

- planner pre-mortem: known traps, avoid rules, and extra checks
- coder constraints: compact anti-patterns and verifier requirements
- reviewer/judge guard: candidate assessments against retrieved failure memory
- repair context: correction strategies retrieved after failed validation

Each influence point emits a `memory_retrieval` event with selected memory ids,
rejected count, constraint count, and an artifact ref. Experiments should ablate
these switches separately before claiming memory improves outcomes.

Retrieval also passes through `strategy_memory.policy` before memories are made
model-visible:

- `balanced`: exploit only high-confidence matches and bypass likely negative
  transfer.
- `exploit_memory`: force selected memories to be used.
- `explore_alternative`: retrieve and report memories, then bypass them so the
  workflow explores another path.
- `random_control`: deterministic exploit/bypass assignment for control runs.

Each decision emits a `memory_policy` event with selected-before/after counts,
bypassed memory ids, and a reason. `tedge experiment error-loop
--memory-policy <mode>` stores the mode in `manifest.json` and reports
exploit/bypass counts in `trials.jsonl`, `metrics.json`, and `report.md`.

Verification failures also emit `repair_policy` events before a repair attempt.
The policy records a compact failure class, stable failure signature,
occurrence count, action, strategy, and reason. The first semantic verifier
failure may proceed to patch repair, but a repeated same-signature failure
escalates instead of silently repeating the same repair strategy. Environment,
provider-output, wrong-file, and missing-context failures are routed away from
blind patch repair so the trace explains why the workflow stopped or needs
broader context.

Patch, shell, and repair attempts emit `outcome_prediction` before the action and
`outcome_observation` after it. Observations classify mismatches as
`wrong_assumption`, `incomplete_context`, `wrong_validator`,
`environment_issue`, `flaky_result`, or `unsafe_action_blocked`. Failure-memory
records store prediction and observation event ids plus aggregate prediction
accuracy, so a lesson can reference what the workflow expected before comparing
it with external validation.

## Current Failure Classes

- `coding_error`
- `validation_failed`
- `review_or_judge_blocked`
- `provider_failure`
- `routing_blocked`
- `environment_failure`
- `partial_completion`
- `no_candidate_selected`
- `workflow_incomplete`

These classes are workflow diagnostics. They should help route future tasks and
explain why a memory was selected, but they are not ground-truth labels unless a
human or benchmark harness verifies them.

Repair-policy failure classes are separate runtime routing labels:

- `semantic_test_failure`
- `environment_failure`
- `provider_parse_failure`
- `wrong_file_patch`
- `missing_context`
- `unknown_failure`

## Caveats

- Failure memories are project-local and may be stale after refactors.
- Similar task text does not guarantee similar root cause.
- Provider, quota, and local environment failures must not be counted as model
  reasoning mistakes.
- Hidden validators must not be leaked into memory records.
- A completed retry does not prove the memory caused the recovery; it only
  records that the memory was available.

## Falsification Criteria

An error-loop experiment should be treated as not supported if any of these hold:

- Retrieved memories reduce pass rate or increase repeated-error rate versus a
  no-memory baseline.
- Retrieved memories improve visible tests but reduce hidden-test pass rate.
- Cost, latency, or strong-agent calls rise more than the recovery gain justifies.
- Memory records contain secrets, raw bulky artifacts, or hidden-validator
  content.
- The selected memory rationale cannot be reproduced from stored metadata.

## Minimum Report Fields

Research exports should report:

- task set and train/transfer split
- model/provider locks
- memory write policy
- memory retrieval policy
- repeated-error rate
- recovery speed
- hidden-test pass rate
- estimated cost
- strong-agent calls
- trace completeness
- memory update status counts
- prediction accuracy / mismatch counts
- recovery attempts after first failure
- repeated same-class error rate
- validation pass rate
- transfer pass rate, or `null` when no transfer split exists
- memory retrieval precision
- harmful retrieval rate
- repair success after retrieval
- leakage checks

The product claim should stay narrow:

> TomorrowEdge can preserve and retrieve compact failure evidence to improve
> workflow supervision and repair routing under budget constraints.
