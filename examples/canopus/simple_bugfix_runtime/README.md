# Canopus Runtime simple bugfix demo

This is the public Canopus schema version of the real bugfix acceptance demo.
It starts with a failing unit test and converges only after an AgentBridge
changes code and the blocking check passes.

Run from the repository root:

```bash
npm run dev -- canopus run examples/canopus/simple_bugfix_runtime/objective.yaml \
  --cwd examples/canopus/simple_bugfix_runtime \
  --adapter shell \
  --action-command "node fix-bug.mjs" \
  --run-id canopus_161_acceptance
```

The legacy `examples/control_plane/*/goal.yaml` demos remain supported for
v1.6 compatibility. New public examples use
`objective/acceptance/convergence`.
