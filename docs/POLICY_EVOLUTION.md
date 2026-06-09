# Policy Evolution

Policy Evolution is the offline evaluation path for TomorrowEdge orchestration
policies.

It is inspired by evolutionary algorithms, but the evolved unit is not an
answer, prompt, or agent. The evolved unit is the **Orchestration Policy
Genome**: a bounded set of role-routing, verification, repair, budget, and stop
preferences. The objective-action-feedback trace is the fitness signal.

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

The safety boundary cannot be mutated. A policy variant may become stricter,
cheaper, or more evidence-hungry, but it cannot grant forbidden tools, weaken
access modes, hide model calls, or bypass the event ledger.

## Fitness

Stored objective traces are scored with:

- final status
- contract quality
- evidence score
- trace completeness
- repair recovery
- policy alignment with the trace context
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
