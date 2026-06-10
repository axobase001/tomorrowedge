# Self-Iterating Orchestration

TomorrowEdge v1.3 introduces a conservative self-iteration layer for coding
workflows.

This is not an online self-modifying agent. The implementation is intentionally
bounded:

- contract-first planning guards the objective
- trace-guided retrieval provides prior lessons
- policy genomes expose only safe orchestration knobs
- offline policy evolution scores variants against stored traces
- runtime policy selection is explicit and auditable

The goal is to improve role routing, verification strictness, repair behavior,
and stop conditions without weakening access-mode safety or hiding decisions
from the cockpit.

## Core innovation: Orchestration Policy Genome

The v1.3 self-iteration layer is inspired by evolutionary algorithms, but
TomorrowEdge does not evolve answers, prompts, or agents. The unit of evolution
is orchestration policy.

An Orchestration Policy Genome controls bounded workflow choices:

- contract depth and required evidence
- plan-step evidence binding
- role routing preference and reviewer/judge thresholds
- verification strictness and trace completeness expectations
- repair retry limits and recurring-failure behavior
- final stop mode and partial-completion policy

The objective-action-feedback trace is the fitness signal. Each run records the
objective, allowed actions, role graph, evidence, tool calls, cost, repair
behavior, review/judge outcome, and stop reason. Offline evolution scores policy
variants against those traces.

The safety boundary cannot be mutated. Policies can tune orchestration behavior,
but they cannot grant forbidden tools, weaken access mode, hide model calls, or
bypass the event ledger.

## Config

```yaml
self_iterating_orchestration:
  enabled: true
  mode: trace_guided
  allow_policy_mutation: false
  allow_offline_evolution: true
  max_policy_variants: 15
  elite_retention: 2
```

Modes:

- `off`: no trace-guided policy selection
- `trace_guided`: select a stored or default policy and retrieve similar traces
- `offline_evolution`: allow the run to record offline policy evolution events
- `experimental_online`: reserved for guarded experiments; mutation still
  requires explicit config

## CLI

```bash
tedge policy inspect
tedge policy evolve --offline --generations 2 --population 4 --elite 2
tedge policy eval
```

Policy evolution uses stored objective traces. It does not call providers or
execute tasks by itself.
