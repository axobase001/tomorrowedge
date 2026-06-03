# Orchestration Backends

TomorrowEdge is not another agent framework. It is a full-access cockpit for
native workflows and existing agent frameworks.

The cockpit owns the durable product surface:

- access modes and autonomy boundaries
- multi-model routing
- human authorization
- event ledger and artifacts
- trace, replay, export, and TUI visibility

External frameworks are backend adapters. They may execute a workflow, but they
must not own the cockpit contract.

## Backend Interface

Every backend implements:

```ts
export interface OrchestrationBackend {
  id: "native" | "langgraph" | "crewai" | "autogen";
  name: string;
  load(config: TomorrowEdgeConfig): Promise<void> | void;
  run(input: OrchestrationRunInput): AsyncIterable<TomorrowEdgeEvent>;
}
```

`run()` returns TomorrowEdge events. This keeps replay/export/TUI semantics
stable even if the execution engine changes.

## Current Backends

| Backend | Status | Purpose |
| --- | --- | --- |
| `native` | executable | Wraps the existing TomorrowEdge agent graph. |
| `langgraph` | placeholder | Adapter slot for LangGraph state graphs. |
| `crewai` | placeholder | Adapter slot for CrewAI crew/task execution. |
| `autogen` | placeholder | Adapter slot for AutoGen-style multi-agent runtimes. |

The placeholder backends intentionally fail with a clear error if selected:

```text
Orchestration backend "langgraph" is not executable in this build...
```

## Config

```yaml
orchestration:
  backend: native
  langgraph:
    enabled: false
    module: ""
    entrypoint: ""
    options: {}
  crewai:
    enabled: false
    module: ""
    entrypoint: ""
    options: {}
  autogen:
    enabled: false
    module: ""
    entrypoint: ""
    options: {}
  mcp_tools:
    enabled: false
    servers: []
    exposeToolsToBackend: false
```

## Design Rule

Framework adapters can provide execution. TomorrowEdge keeps supervision,
authorization, routing, and traceability.

Do not hand the full-access cockpit to an external framework. Convert framework
steps into TomorrowEdge events instead.

