# Adaptive Orchestration Runtime

TomorrowEdge 1.4 introduces the Adaptive Orchestration Runtime.

This release does not replace the native executor with a new framework. Instead,
it strengthens the existing phased executor with runtime-visible orchestration
objects:

- `TaskGraph`: structured planner output and dependency model;
- `RoleGraphScheduler`: role-node execution state, task gating, and result
  events;
- `EvidenceDependency`: explicit evidence gaps before review, judge, runner,
  repairer, and summarizer handoffs;
- `Debate Protocol v2`: structured claims, moves, candidate-scoped unresolved
  blocking issues, global blocking issues, and selected-candidate resolution;
- `Policy Counterfactual Replay`: offline trace-level policy fitness projection
  over objective-action-feedback traces;
- `External Agent Adapters`: generic, Codex, and Claude Code normalization
  surfaces;
- `evaluateModelCallInvocation`: one budget gate API for planner/live/debate
  model calls.

The hardening pass after the initial 1.4 cut makes these structures execution
relevant instead of merely visible:

- role nodes now use scheduler APIs (`canRunRoleNode`, `beginRoleNode`,
  `completeRoleNode`, `blockRoleNode`, and `skipRoleNode`) before normal agent
  success paths can mark graph progress, while the native executor still owns
  phase sequencing;
- patch workflows split runner work into `patch_runner` and `test_runner`, so
  patch application and verification evidence are not collapsed into one vague
  runner result;
- read-only finalization explicitly skips optional governance nodes before the
  summarizer can complete;
- debate issues are candidate-scoped, so a rejected losing candidate no longer
  blocks a good selected candidate unless the issue is global or attached to
  the selected candidate;
- task nodes emit `task_node_result` events and validate ready-role execution,
  apply, and verify dependencies against the TaskGraph;
- Codex and Claude Code adapters now build role-specific prompts, normalize
  typed plan/patch/review/judgment payloads, extract evidence, detect malformed
  outputs, and record cost metadata when available;
- policy counterfactual replay now records decision-level changes, not only a
  projected fitness score, and the comparison is a trace-level policy
  tournament rather than an online task-execution tournament;
- model-backed planner, task governance, live patch, live advisory, and
  pre-judge model debate calls reserve budget before invocation and commit or
  release after the call outcome;
- external Codex/Claude Code adapter calls can retry malformed typed outputs
  according to adapter policy and convert normalized role outputs into
  EvidencePackets.

The 1.4.1 hardening pass tightens the same boundary:

- patch workflows dispatch executable work from the intersection of
  RoleGraph-ready nodes and TaskGraph-ready task nodes;
- optional `coder_b` branches require explicit `produce_patch_alt` task nodes,
  and stale cached/model task graphs are rebuilt when they no longer match the
  selected RoleGraph;
- approval-blocked patch workflows classify missing shell evidence under
  `blockedByApproval`, while intentional skips remain separate from ordinary
  missing trace evidence;
- Debate Protocol v2 reports selected/global/non-selected issue counts and
  keeps ordinary candidate-local security concerns scoped to their candidate;
- budget decisions mark real provider calls separately from simulated
  mock/fixture/local governance calls;
- external Codex/Claude Code EvidencePackets keep stable diff, review, and
  judge artifact refs when those refs are provided by the external agent.

The key principle is unchanged:

> Strong agents decide. Efficient agents execute. Local agents protect privacy.
> Humans authorize the actions that matter.

The 1.4 runtime makes those decisions easier to inspect and harder to fake. It
records why a plan was shaped as a graph, which role node was allowed by the
TaskGraph, which task node completed or blocked, what evidence was missing, how
reviewer/judge debate resolved for the selected candidate, how policy variants
would have scored across traces, and how external agent output was normalized.

Current boundary:

- native backend remains the real executor;
- external frameworks remain adapters/plugins;
- TaskGraph and RoleGraphScheduler now gate selected runtime paths, but this is
  RoleGraph-gated phased execution, not a fully asynchronous graph runner;
- policy counterfactuals are decision-level offline trace projections, not
  online self-modification;
- external Codex/Claude Code integration is adapter-specific for typed role
  handoffs, but it is still not a guarantee that every vendor CLI feature is
  deeply integrated.
