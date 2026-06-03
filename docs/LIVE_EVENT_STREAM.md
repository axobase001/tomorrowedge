# Live Event Stream Architecture Note

TomorrowEdge currently records a complete post-run event ledger:

```text
runOfflineGraph(...)
  -> AgentGraphState.events
  -> .tomorrowedge/sessions/<session-id>/events.jsonl
  -> tedge trace / replay / export
```

This is enough for replay and audit, but the next cockpit step is live streaming.
The graph runner should eventually become an async event stream:

```ts
for await (const event of runGraphEvents(input)) {
  ledger.append(event);
  tui.render(event);
}
```

Target shape:

- Provider calls emit `model_call:start`, `model_call:success`, and `model_call:failure` immediately.
- Patch, shell, repair, fallback, cost, and evidence updates stream as soon as they happen.
- The TUI subscribes to the event stream instead of waiting for a completed `AgentGraphState`.
- `session.json` remains the index; `events.jsonl` remains the durable black-box ledger.
- Full mode stays autonomous. Streaming improves visibility; it does not add per-step blocking.

This turns the current post-run cockpit into a live full-access cockpit while
keeping the replay/export format stable.
