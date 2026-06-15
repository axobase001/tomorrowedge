# Canopus Runtime failing-task demo

This demo intentionally never converges. It exists to prove that blocking
checks have veto power.

Run from the repository root:

```bash
npm run dev -- control run examples/control_plane/failing_task/goal.yaml --cwd examples/control_plane/failing_task
```

Expected behavior:

- The `impossible_gate` command exits nonzero.
- The checker stub may produce an advisory pass, but it cannot override the
  blocking-check failure.
- The ConvergenceEngine aborts after the configured failure policy.
- The final `status.latest.json` decision explains why convergence was denied.
