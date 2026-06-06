# Four-Zone Quiet Cockpit Wireframe

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Top Bar: workspace / mode / session / cost / tokens / cache / status       │
├───────────────┬───────────────────────────────────────────────┬────────────┤
│ Task List     │ Workflow Spine / Main Workspace                │ Telemetry  │
│               │ Plan Route Edit Review Test Judge Approve      │ Summary    │
│ Current task  │                                               │ Models/API │
│ Recent tasks  │ Current state view                             │ Cost       │
│ Waiting       │ Approval state -> Diff / Patch Approval        │ Agents     │
│ Sessions      │                                               │ Risk       │
├───────────────┴───────────────────────────────────────────────┴────────────┤
│ Natural Language Command Composer: task / constraints / approval feedback  │
└────────────────────────────────────────────────────────────────────────────┘
```

The bottom composer is intentionally short. Trace and detail are progressively
disclosed through a collapsed trace strip and a side drawer rather than through
a permanent log waterfall.
