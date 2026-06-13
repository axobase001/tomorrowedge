# Agent Council Rust Rewrite Demo

This is a deterministic Sirius demo target for the Agent Council Governance
Runtime.

The demo does not depend on real Codex, Claude Code, DeepSeek, or MiMo
processes. Those are replaceable examples. The runtime uses configured
capability profiles, mock/fixture providers, and the same event ledger path as
real sessions.

## Run

```bash
npm run dev -- council run "rewrite this application in Rust" \
  --headless \
  --fixture-mode \
  --access-mode full \
  --simulate-failure rust_cli_structure
```

Expected trace shape:

- Chief Agent selected.
- Chief Agent emits initial plan.
- Council members emit critique and gap-fill moves.
- Consensus TaskGraph is produced.
- Task nodes receive concrete owner agents and assignment reasons.
- Delegated execution records evidence and artifacts.
- Simulated failure triggers bounded Strategy Mutation.
- Final result returns to Chief Agent review/judge.

## Inspect

```bash
npm run dev -- trace latest --verbose
npm run client
```

In the GUI, open the detail drawer and inspect:

- Agent Council governance;
- TaskGraph owners and reasons;
- policy mutation summary;
- Chief final review.
