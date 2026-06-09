# Agent Graph

Default order:

1. Planner
2. Explorer
3. Coder-A
4. Coder-B
5. Reviewer
6. Judge
7. Runner
8. Repairer
9. Summarizer

Since 1.2.11, the default order is treated as the native fallback execution
path, not the only orchestration contract. `src/core/orchestration/roleGraph.ts`
defines workflow-kind-aware role graphs:

- `read_only`: Planner -> Explorer -> Summarizer
- `patch`: Planner -> Explorer -> Coder-A -> Reviewer -> Judge -> Runner -> Summarizer
- `debate_patch`: adds optional parallel Coder-B after Explorer
- `high_risk_patch`: requires Reviewer and Judge before apply
- `repair_loop`: Runner failure -> Repairer -> lightweight Review -> Runner

The current native executor still runs mostly sequentially, but it now records
the workflow kind and role graph so future scheduler work can move dependency
handling out of the fixed pipeline without changing the event ledger contract.

Runner is a local tool, not an LLM agent. In `partial` mode it cannot execute
without approval. In `full` mode patch, shell, and repair actions are
auto-approved and written to the event ledger.

The offline fixture graph now supports a full deterministic loop:

```text
candidate diff -> judge selection -> patch approval -> test approval -> repair candidate -> repair approval -> rerun tests -> final evidence
```

Repair is intentionally gated separately from the initial patch. `--repair-on-fail`
allows the Repairer role to propose a follow-up patch after a failed approved
test run. In `partial` mode, `--approve-repair` is required before that patch
touches disk. In `full` mode, repair is autonomous within configured loop limits.

Every run records a replayable event stream:

```text
.tomorrowedge/sessions/<session-id>/
  session.json
  events.jsonl
  artifacts/
```

Use:

```bash
tedge trace latest
tedge export latest --format markdown
tedge export latest --brief
tedge export latest --format json
```

`--red-team-review` adds adversarial findings to each candidate review before
Judge selection. Critical findings force `ask_user`; lower-severity findings are
kept visible in the review and TUI debate pane.

Fixture demo:

```bash
tedge run "fix failing test" --headless --fixture-mode --approve-patch --approve-shell --fixture-failing-patch --repair-on-fail --approve-repair
```
