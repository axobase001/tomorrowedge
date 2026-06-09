# Error-Loop Memory Research Notes

TomorrowEdge treats failure memory as a local engineering aid, not as proof that
an agent has learned in the human sense. The current implementation stores
compact failure records from saved sessions and exposes them through:

```bash
tedge memory failures
tedge memory show <failure-id>
tedge memory explain "task description"
```

Each failure record keeps a task fingerprint, a short redacted goal preview,
a failure class, a correction strategy, confidence, recurrence count, and
artifact refs. It intentionally avoids raw stdout, stderr, diffs, provider
payloads, and secrets.

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
- leakage checks

The product claim should stay narrow:

> TomorrowEdge can preserve and retrieve compact failure evidence to improve
> workflow supervision and repair routing under budget constraints.
