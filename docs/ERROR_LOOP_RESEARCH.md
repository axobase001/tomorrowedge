# Error-Loop Memory Research Notes

TomorrowEdge treats failure memory as a local engineering aid, not as proof that
an agent has learned in the human sense. The current implementation stores
compact failure records from saved sessions and exposes them through:

```bash
tedge memory failures
tedge memory show <failure-id>
tedge memory explain "task description"
tedge experiment error-loop --ablation memory_on,memory_off
```

Each failure record keeps a task fingerprint, a short redacted goal preview,
a failure class, a correction strategy, confidence, recurrence count, artifact
refs, project scope, source session IDs, and first/last seen timestamps. It
intentionally avoids raw stdout, stderr, diffs, provider payloads, and secrets.

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

Normal project runs do not write failure-memory records by default. The
experiment harness opts in with `failure_memory.enabled: true` and marks records
as `storage_scope: experiment`, so research memory stays isolated from ordinary
project memory unless the user explicitly enables it.

`metrics.json` also separates:

- `memoryWritten`: new memory records created
- `memoryOccurrences`: selected or updated failure records observed in trials
- `suspectedNegativeTransfer`: trials where retrieved memory was available but
  the workflow still did not complete

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

When strategy memory is enabled, retrieval can influence four workflow points:

- planner pre-mortem: known traps, avoid rules, and extra checks
- coder constraints: compact anti-patterns and verifier requirements
- reviewer/judge guard: candidate assessments against retrieved failure memory
- repair context: correction strategies retrieved after failed validation

Each influence point emits a `memory_retrieval` event with selected memory ids,
rejected count, constraint count, and an artifact ref. Experiments should ablate
these switches separately before claiming memory improves outcomes.

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
- leakage checks

The product claim should stay narrow:

> TomorrowEdge can preserve and retrieve compact failure evidence to improve
> workflow supervision and repair routing under budget constraints.
