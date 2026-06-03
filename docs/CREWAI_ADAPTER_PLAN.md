# CrewAI Adapter Plan

The CrewAI adapter is a placeholder in 0.1.1. TomorrowEdge should be able to
supervise a CrewAI crew, but CrewAI should not replace the cockpit.

## Intended Mapping

| CrewAI concept | TomorrowEdge contract |
| --- | --- |
| Agent | routed agent role |
| Task | plan step or execution phase |
| Crew kickoff | backend run start |
| Tool use | event-ledger tool event |
| Final output | summary artifact |

## Requirements Before Execution

- Load adapter config from `orchestration.crewai`.
- Create a narrow role/task bridge instead of handing over all workspace access.
- Emit `agent_run`, `model_call`, `patch_candidate`, `review_decision`, and
  `summary` events where applicable.
- Preserve human authorization for patch, shell, and repair actions.
- Keep outputs as artifacts so trace/export remain useful.

## Placeholder Behavior

Selecting:

```yaml
orchestration:
  backend: crewai
```

currently raises a clear unavailable-backend error. The adapter will become
executable only after CrewAI task progress can be represented as
`TomorrowEdgeEvent` records.

