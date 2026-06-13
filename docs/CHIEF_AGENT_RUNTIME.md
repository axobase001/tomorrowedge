# Chief Agent Runtime

The Chief Agent is the high-level owner of a governed engineering task.

It can be a configured external agent such as Codex MCP or Claude Code, a strong
remote model routed through OpenRouter, or a local/mock/fixture profile for
tests. The role is replaceable through configuration.

## Responsibilities

- Understand the high-level user goal.
- Produce the initial governed plan.
- Decide whether to convene an Agent Council.
- Preserve the Objective Contract boundary.
- Integrate council critique and gap fill into a consensus TaskGraph.
- Perform final code review / judge before delivery.

## Configuration

```yaml
chief_agent:
  id: codex
  provider: external:codex
  model: Codex
  roles:
    - lead_planner
    - architecture_reviewer
    - final_judge
    - final_code_review
  trustLevel: high
  costTier: expensive
```

If no chief is configured, TomorrowEdge selects one from available capability
profiles by planning, architecture, review, judging, reliability, and risk.

## Non-Negotiable Boundary

The Chief Agent may plan, judge, or request revision. It cannot mutate the
Objective Contract safety boundary, remove required high-risk review/judge
roles, or bypass the event ledger.
