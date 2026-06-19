# Delegated Execution Runtime

Sirius turns each consensus TaskGraph node into an owned execution unit.

Every core node records:

- `ownerAgentId`
- assigned provider
- assigned model
- assignment reason
- claim mode
- alternate candidates for bounded mutation
- evidence refs
- artifact refs

## Execution Contract

Delegated execution emits:

- `budget_decision`
- `evidence_packet`
- `delegated_task_result`
- `delegated_execution_mode`
- `task_node_result`

BudgetGate decides whether a call is allowed before execution. EvidencePacket
and artifact refs make the result auditable by reviewer, judge, final chief
review, and trace export.

If a TaskGraph node is owned by `external:<id>` and
`external_agents.<id>.command` is configured, Sirius invokes that command
runner and passes the task/context envelope through stdin plus
`TOMORROWEDGE_EXTERNAL_CONTEXT_FILE`. The request, response, result, and error
refs are recorded as `external_agent_*` events and linked back into the
delegated task evidence. If no command is configured, the profile remains a
configured/mock capability node for deterministic tests and planning.

Final summaries and deliverable artifacts include a delegated execution mode:

- `native_governance`: native governance and synthetic evidence packets;
- `external_command`: every delegated result is backed by command-adapter
  artifacts;
- `mixed`: command-backed and native-governance results both appear;
- `native_fallback`: an external assignment did not produce an accepted command
  result and native governance evidence remains authoritative.

This distinction is intentional. A native/fixture Sirius run is a governed
planning and evidence artifact unless command, MCP, or Canopus shell execution
produces concrete patch/test artifacts.

## Failure Handling

When a delegated node fails, Sirius can propose bounded Strategy Mutations:

- split a task;
- switch owner agent;
- add reviewer;
- add judge;
- increase debate;
- trigger council replan;
- relax cost within configured limits;
- tighten evidence.

Mutation is intentionally bounded. It can change execution policy and task
ownership, but not user objective, safety boundary, or forbidden actions.
