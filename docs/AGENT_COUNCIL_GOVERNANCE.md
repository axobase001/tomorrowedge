# Agent Council Governance Runtime

TomorrowEdge Sirius defines the runtime around an Agent Council.

TomorrowEdge is the local governance and policy-evolution runtime for
heterogeneous coding agents. It does not try to replace Codex, Claude Code,
DeepSeek, MiMo, Ollama, or other agents. It turns them into governed,
role-bound members of a software-engineering organization.

## Runtime Flow

```text
User goal
  -> Chief Agent Router
  -> Chief initial plan
  -> Agent Council critique / gap fill / task claim
  -> Consensus TaskGraph
  -> Task ownership assignment
  -> Delegated execution
  -> EvidenceGate + BudgetGate + Debate v2 + Trace Ledger
  -> Bounded Strategy Mutation on failure
  -> Chief final review / judge
  -> Deliverable or revision request
```

## Core Objects

- Chief Agent: the high-level task owner, architecture planner, and final
  judge.
- Council Member: a replaceable agent selected by capability profile for
  critique, implementation, test planning, risk review, or cost control.
- AgentCapabilityProfile: the provider-independent capability layer.
- Consensus TaskGraph: the council-owned execution graph.
- Task ownership assignment: every core TaskGraph node has `ownerAgentId`,
  assigned provider/model, and `assignmentReason`.
- DelegatedTaskResult: the result of an owned task node, with evidence and
  artifact refs.
- StrategyMutationEvent: a bounded runtime change caused by failure, budget
  pressure, evidence gaps, or review/judge blockage.
- ChiefFinalReview: the final delivery gate.

## Trace Events

Sirius writes the following events to the same event ledger used by earlier
TomorrowEdge workflows:

- `chief_agent_selected`
- `chief_agent_decision`
- `chief_initial_plan`
- `council_session_started`
- `council_move`
- `council_consensus`
- `task_ownership_assignment`
- `delegated_task_result`
- `strategy_mutation`
- `strategy_selection_decision`
- `council_replan`
- `chief_final_review`
- `chief_delivery_approved`
- `chief_revision_requested`

These events are replayable through trace export and projected into the GUI
view model.

## CLI

```bash
tedge council run "rewrite this application in Rust" --headless --fixture-mode --access-mode full
tedge run "rewrite this application in Rust" --agent-council --headless --fixture-mode --access-mode full
```

Use `--simulate-failure <taskNodeId>` in fixture runs to exercise bounded
Strategy Mutation:

```bash
tedge council run "rewrite this application in Rust" \
  --headless \
  --fixture-mode \
  --access-mode full \
  --simulate-failure rust_cli_structure
```

## Boundary

Sirius is not a generic personal-agent runtime. It is an engineering governance
runtime for patch, review, verification, evidence, cost, mutation, and final
delivery.

Benchmarks and dashboards remain evaluation utilities. The product core is the
governed Agent Council path.
