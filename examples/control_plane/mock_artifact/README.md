# Canopus Runtime mock artifact demo

This deterministic demo is a no-LLM/no-test smoke path. It proves that the
Canopus Runtime can load a structured objective, invoke a mock AgentBridge, and
persist status/evidence. It is not the Canopus runtime acceptance demo.

Use `examples/control_plane/simple_bugfix_runtime` for the real blocking-check
bugfix runtime demo.

Run from the repository root:

```bash
npm run dev -- control validate examples/control_plane/mock_artifact/goal.yaml
npm run dev -- control run examples/control_plane/mock_artifact/goal.yaml --cwd examples/control_plane/mock_artifact
npm run dev -- control status --cwd examples/control_plane/mock_artifact
npm run dev -- control report --cwd examples/control_plane/mock_artifact
```

Expected behavior:

- The objective is loaded as structured desired state, not as a prompt.
- The mock AgentBridge writes `result.md`.
- The `result_exists` blocking check must pass before convergence.
- `.runs/<run_id>/trace.jsonl`, `status.latest.json`, `progress.md`, and
  `evidence/iteration_001/*` are written.
