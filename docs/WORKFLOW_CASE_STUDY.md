# Workflow Case Study: Fixture Repair Loop

This case study shows a complete TomorrowEdge workflow that can run without API
keys. It is intentionally small, but it exercises the product contract:
planning, patch proposal, review, judge decision, full-access execution,
failure evidence, repair, and export.

## Goal

Fix a failing test in the sample fixture repository while keeping every
important action visible in the event ledger.

## Commands

```bash
npm install
npm run dev -- run "fix failing test" --headless --fixture-mode --access-mode full --repair-on-fail --fixture-failing-patch
npm run dev -- trace latest --verbose
npm run dev -- export latest --format markdown --include-artifacts
npm run verify
```

## What Happens

1. **Planner / Explorer** load the fixture context and record selected files.
2. **Coder** proposes an intentionally bad patch first when
   `--fixture-failing-patch` is enabled.
3. **Reviewer** scores the candidate and records concerns.
4. **Judge** selects the candidate so the full-access path can exercise patch
   application and verification.
5. **Runner** applies the patch and executes the verification command.
6. **Shell evidence** records stdout, stderr, exit code, and artifact refs.
7. **Repairer** proposes a second patch after the failing command.
8. **Runner** applies the repair and reruns the failing verification command.
9. **Summarizer** emits a final delivery status with evidence references.

## Expected Ledger Shape

The full run should include these event types:

```text
access_mode
context_select
patch_candidate
review_decision
judge_decision
patch_apply
shell_run
repair_attempt
patch_apply
shell_run
summary
```

The exported Markdown expands patch diffs and shell stdout/stderr artifact
contents. That is the black-box boundary TomorrowEdge is trying to remove: the
operator should not need to guess which file changed, which command failed, or
why the repair was accepted.

## Why This Matters

The fixture flow is not a benchmark claim. It is a reproducible cockpit demo.
It proves that the core supervision layer works before any paid model is added.
Once this path is healthy, replace `--fixture-mode` with configured providers or
external MCP agents:

```bash
npm run dev -- workflow "fix the failing package test and explain the repair" --providers openrouter,deepseek,anthropic --rounds 2
npm run dev -- run "fix the failing package test" --live --access-mode partial
```

## What To Inspect

- `.tomorrowedge/sessions/<session>/events.jsonl`
- `.tomorrowedge/sessions/<session>/artifacts/diffs/`
- `.tomorrowedge/sessions/<session>/artifacts/stdout/`
- `.tomorrowedge/sessions/<session>/artifacts/stderr/`
- `.tomorrowedge/workflows/<workflow>.md`

The useful question is not only "did the patch pass?" It is also "can a human
or another agent reconstruct how the cockpit reached that answer?"
