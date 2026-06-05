# Context Projection

TomorrowEdge preserves full artifacts for replay, but projects compact evidence
packets to models.

This layer separates two views:

- Runtime Artifact View: complete stdout, stderr, diffs, review JSON, judge
  decisions, file content, and traces remain in the event ledger artifacts.
- Model Context View: providers receive compact, structured, budget-aware
  previews with stable artifact handles.

The goal is not generic tool compression. The goal is coding-workflow evidence:
reviewers and judges should see enough signal to decide without blindly
receiving entire logs or diffs.

## Artifact Kinds

- `stdout` and `stderr` use tail projection.
- `diff` uses structured projection with file and hunk previews.
- `file` uses head/tail projection.
- `review`, `judge`, `trace`, and generic `json` use compact JSON projection.

Every projection writes:

- the original artifact ref
- a provider-view preview artifact ref
- omitted byte count
- token estimate
- policy name

These appear as `artifact_projection` and `context_projection` events.

## Rule

Agents should not blindly receive full logs, diffs, or files. They should
receive provider views unless explicit full context is requested.
