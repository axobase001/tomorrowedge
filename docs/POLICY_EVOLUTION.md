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

## Runtime Status

As of `1.3.1`, the core policy genome is connected to the runtime path, not only
to docs or trace metadata:

- `contractPolicy` changes Objective Contract depth, success criteria, required
  evidence, verification rubric, and stop conditions.
- `planningPolicy.maxStepsMode` and `requirePlanStepEvidenceBinding` affect
  contract-derived plans.
- `routingPolicy`, `verificationPolicy`, `repairPolicy`, and `stopPolicy`
  influence routing tags, verification strictness, repair budgets, and final
  stop decisions.

As of `1.3.2`, the remaining policy knobs in this section are also wired:

- `planningPolicy.allowParallelRoles=false` disables optional `coder_b`,
  parallel patch candidates, and debate-style optional branches while keeping
  required reviewer/judge governance available.
- `tracePolicy.preferRecent`, `preferSuccessTraces`, `preferFailureTraces`, and
  `avoidStaleTraces` weight `retrieveSimilar` scoring alongside same-scenario
  and same-workflow boosts.

Mutation is limited to these fields. It does not modify prompts, permissions,
provider credentials, shell policy, or source code.

The safety boundary cannot be mutated. A policy variant may become stricter,
cheaper, or more evidence-hungry, but it cannot grant forbidden tools, weaken
access modes, hide model calls, or bypass the event ledger.

Offline mutation uses a bounded operator set that covers every runtime-wired
genome group: contract depth, trace weighting, planning shape, parallel-role
policy, routing preference, reviewer/judge thresholds, verification strictness,
repair retries, and stop behavior. The default population size matches this
operator set so `tedge policy evolve --offline` explores the documented genome
surface before selecting elites.

When a selected policy changes `routingPolicy.routingPreference`, the runtime
rebuilds subsequent role assignments before planner/coder/reviewer execution.
Privacy/local routing locks and explicit role overrides remain hard boundaries.

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
