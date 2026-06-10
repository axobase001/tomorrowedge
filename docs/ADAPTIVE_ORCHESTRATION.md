# Adaptive Orchestration Runtime

TomorrowEdge 1.4 introduces the Adaptive Orchestration Runtime.

This release does not replace the native executor with a new framework. Instead,
it strengthens the existing phased executor with runtime-visible orchestration
objects:

- `TaskGraph`: structured planner output and dependency model;
- `RoleGraphScheduler`: role-node execution state and result events;
- `EvidenceDependency`: explicit evidence gaps before review, judge, runner,
  repairer, and summarizer handoffs;
- `Debate Protocol v2`: structured claims, moves, unresolved blocking issues,
  and resolution;
- `Policy Counterfactual Replay`: offline policy fitness projection over
  objective-action-feedback traces;
- `External Agent Adapters`: generic, Codex, and Claude Code normalization
  surfaces;
- `evaluateModelCallInvocation`: one budget gate API for planner/live/debate
  model calls.

The key principle is unchanged:

> Strong agents decide. Efficient agents execute. Local agents protect privacy.
> Humans authorize the actions that matter.

The 1.4 runtime makes those decisions easier to inspect. It records why a plan
was shaped as a graph, which role node completed or blocked, what evidence was
missing, how reviewer/judge debate resolved, how policy variants would have
scored, and how external agent output was normalized.

Current boundary:

- native backend remains the real executor;
- external frameworks remain adapters/plugins;
- TaskGraph and RoleGraphScheduler are runtime-visible structure, not yet a
  fully asynchronous graph runner;
- policy counterfactuals are offline trace projections, not online
  self-modification.
