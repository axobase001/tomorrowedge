# Policy Evolution

Policy Evolution is the offline evaluation path for TomorrowEdge orchestration
policies.

Each policy genome is a structured set of orchestration preferences:

- contract depth
- trace retrieval top-k
- parallel role preference
- routing preference
- verification strictness
- repair retry behavior
- stop mode

Mutation is limited to these fields. It does not modify prompts, permissions,
provider credentials, shell policy, or source code.

## Fitness

Stored objective traces are scored with:

- final status
- contract quality
- evidence score
- trace completeness
- repair recovery
- estimated cost penalty
- contract violation penalty
- fallback instability penalty

The selected policies are written to:

```text
.tomorrowedge/orchestration-policies.json
```

## Commands

```bash
tedge policy inspect
tedge policy evolve --offline
tedge policy eval
tedge policy eval --taskset benchmarks/tasks.json
```

`policy eval --taskset` currently summarizes a taskset alongside stored-trace
evaluation. It does not execute the taskset; benchmark execution remains a
separate concern.

