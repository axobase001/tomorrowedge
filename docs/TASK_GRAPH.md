# Task Graphs

TomorrowEdge 1.4 adds a `TaskGraph` layer to planner output.

A `Plan` still contains human-readable `steps`, but it can now also carry a
validated graph:

```ts
type TaskGraph = {
  graphId: string;
  goal: string;
  workflowKind?: WorkflowKind;
  riskLevel: RiskLevel;
  nodes: TaskGraphNode[];
  edges: TaskGraphEdge[];
  entryNodeIds: string[];
  terminalNodeIds: string[];
};
```

Each node records phase, role hints, dependencies, required evidence, expected
artifacts, and status. Native planner output, Objective Contract-derived plans,
and model-backed planner output all pass through validation. If a model omits
or returns an invalid task graph, TomorrowEdge rebuilds it with the native graph
builder and records the repair as trace evidence.

Current status:

- implemented in `src/core/planning`;
- attached to `Plan.taskGraph`;
- emitted as `task_graph` events;
- used as runtime-visible planning structure;
- not yet a full async executor replacement.

The native executor remains a phased pipeline while TaskGraph and
RoleGraphScheduler harden into the future live scheduler.
