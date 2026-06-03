# LangGraph Adapter Plan

The LangGraph adapter is a placeholder in 0.1.1. It exists to make the backend
boundary explicit before wiring a third-party runtime.

## Intended Mapping

| LangGraph concept | TomorrowEdge contract |
| --- | --- |
| StateGraph node | `agent_run` or domain event |
| Edge transition | `evidence_update` or routing metadata |
| Tool node | `shell_run`, `patch_apply`, or MCP tool event |
| Checkpoint | session artifact |
| Stream update | `TomorrowEdgeEvent` |

## Requirements Before Execution

- Load adapter config from `orchestration.langgraph`.
- Resolve a module/entrypoint without bundling LangGraph into the core package.
- Convert node start/success/failure into event ledger entries.
- Keep patch/shell/repair approval controlled by TomorrowEdge access modes.
- Preserve model routing decisions from TomorrowEdge unless explicitly delegated.

## Placeholder Behavior

Selecting:

```yaml
orchestration:
  backend: langgraph
```

currently raises a clear unavailable-backend error. This is intentional until
LangGraph execution can be streamed into the event ledger without weakening the
cockpit contract.

