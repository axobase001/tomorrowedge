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

Runner is a local tool, not an LLM agent. It cannot execute without approval.

The offline fixture graph now supports a full deterministic loop:

```text
candidate diff -> judge selection -> patch approval -> test approval -> repair candidate -> repair approval -> rerun tests -> final evidence
```

Repair is intentionally gated separately from the initial patch. `--repair-on-fail`
allows the Repairer role to propose a follow-up patch after a failed approved
test run, while `--approve-repair` is required before that patch touches disk.

`--red-team-review` adds adversarial findings to each candidate review before
Judge selection. Critical findings force `ask_user`; lower-severity findings are
kept visible in the review and TUI debate pane.

Fixture demo:

```bash
tedge run "fix failing test" --headless --provider fixture --approve-patch --approve-shell --fixture-failing-patch --repair-on-fail --approve-repair
```
