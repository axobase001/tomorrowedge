# Policy Evolution Runtime

TomorrowEdge policy evolution is governance-level evolution.

The unit of evolution is not the answer, prompt, or agent. It is the
orchestration policy.

## Sirius Runtime Mutation

Sirius adds execution-time bounded Strategy Mutation for Agent Council runs.
Mutation is triggered by concrete runtime signals such as:

- delegated task failure;
- review blocked;
- judge request revision;
- budget blocked;
- evidence gap;
- agent failure;
- timeout.

The runtime records both the candidate mutation and the selected strategy:

- `strategy_mutation`
- `strategy_selection_decision`

## Safety Boundary

Mutation cannot:

- relax forbidden actions;
- remove high-risk reviewer or judge requirements;
- bypass Chief final review;
- hide evidence or artifacts;
- disable trace recording.

Policy evolution is allowed to improve orchestration under constraints. It is
not allowed to rewrite the contract that protects the user.
