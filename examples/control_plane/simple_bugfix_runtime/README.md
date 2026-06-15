# Canopus Runtime simple bugfix demo

This demo is the Canopus runtime acceptance fixture. It starts with a real
failing test and converges only after the convergence loop drives an AgentBridge to
modify code.

Initial bug:

```js
export function add(a, b) {
  return a - b;
}
```

Blocking check:

```bash
npm test
```

Run from the repository root:

```bash
npm run dev -- control run examples/control_plane/simple_bugfix_runtime/goal.yaml \
  --cwd examples/control_plane/simple_bugfix_runtime \
  --adapter shell \
  --action-command "node fix-bug.mjs" \
  --run-id simple_bugfix_runtime
```

Expected Canopus behavior:

- iteration 001 records pre-action failing `npm test` evidence.
- the shell AgentBridge patches `index.js`.
- iteration 001 records post-action passing `npm test` evidence.
- final `status.latest.json` is `phase: converged`.
- `satisfied_conditions` includes `unit_tests_pass`, `diff_exists`,
  `no_denied_path_modified`, and `evidence_collected`.
- `.runs/<run_id>/evidence/iteration_001/pre_action/unit_tests_pass.log`
  contains the initial failing test output.
- `.runs/<run_id>/evidence/iteration_001/unit_tests_pass.log` contains the
  final passing test output used for convergence.
