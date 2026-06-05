# Architecture Upgrade

This upgrade learns from OpenSquilla's runtime architecture without turning
TomorrowEdge into a general personal-agent runtime.

TomorrowEdge remains a full-access coding workflow cockpit and heterogeneous
coding-agent control layer.

## Phase 1: Context And Evidence

Implemented in 0.6.0:

- context projection reducers
- runtime artifact view vs provider context view
- evidence packets
- routing and budget diagnostic events
- trace completeness score
- typed external-agent task/result envelopes
- `tedge trace latest --diagnostics`
- `tedge diagnostics latest`

## Phase 2: Role Routing And Budget

Next:

- promote role-routing policy from scaffolding to active config
- enforce strong-agent budget rationing
- expose routing explanations in TUI panes and exports

## Phase 3: External Agent Contract

Next:

- require typed role outputs from real external Codex/Claude Code adapters
- improve error recovery and long-task state sync
- support stricter envelope validation

## Phase 4: Productization

Next:

- workflow recipes
- session inspector
- product guide split
- local cockpit API

## Phase 5: Benchmarks

Next:

- quality-cost-trace frontier harness
- trace completeness metrics in benchmark reports
- cost per passed hidden test
