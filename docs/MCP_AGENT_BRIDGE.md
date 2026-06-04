# MCP Agent Bridge

TomorrowEdge is not replacing Claude Code / Codex.

It turns them into role-bound agents inside a visible multi-model cockpit. Codex / Claude Code gives agents full access. TomorrowEdge gives full access a cockpit.
TomorrowEdge does not replace the Claude Code / Codex subscriptions you already have. It turns them into orchestratable and observable role nodes.

The MCP Agent Bridge exposes TomorrowEdge as a local MCP server so external coding agents can join a workflow as `core`, `planner`, `reviewer`, `judge`, `coder_a`, `repairer`, or another configured role. TomorrowEdge keeps orchestration, routing, trace, event ledger, session export, and TUI supervision in its own core.

## Commands

```bash
tedge mcp serve
tedge mcp tools
tedge mcp agents
tedge mcp agents --probe
tedge mcp invoke codex --session latest --role reviewer --prompt "review the current workflow"
```

`tedge mcp serve` starts the stdio transport. The first implementation is intentionally transport-light and offline-testable. HTTP/SSE can be added later without changing the bridge state model.
`tedge mcp agents --probe` starts configured external MCP commands, runs `initialize`, and lists available tools. `tedge mcp invoke` calls a configured external MCP process and writes start/success/failure/result events into the same session ledger.

## Exposed Tools

- `tomorrowedge.start_workflow`
- `tomorrowedge.get_workflow_state`
- `tomorrowedge.register_external_agent`
- `tomorrowedge.submit_agent_result`
- `tomorrowedge.record_event`
- `tomorrowedge.get_context`
- `tomorrowedge.propose_patch`
- `tomorrowedge.submit_review`
- `tomorrowedge.submit_judgment`
- `tomorrowedge.get_trace`
- `tomorrowedge.export_session`

External agents are not allowed to submit only a final answer. Important actions become ledger events:

- `external_agent_registered`
- `external_agent_call`
- `external_agent_result`
- `external_agent_patch_candidate`
- `external_agent_review`
- `external_agent_judgment`
- `external_agent_error`
- `external_agent_cost_usage`

## Example Role Binding

```yaml
external_agents:
  claude_code:
    enabled: true
    transport: mcp
    roles: [core, planner, reviewer, judge]
    capabilities: [core, planning, review, judgment]
    trustLevel: high
  codex:
    enabled: true
    transport: mcp
    command: codex
    args: [mcp-server]
    autoStart: true
    roles: [core, coder_a, repairer, reviewer]
    capabilities: [core, coding, repair, review]
    trustLevel: high

agents:
  planner:
    provider: external:claude_code
    model: auto
  reviewer:
    provider: external:codex
    model: auto
  judge:
    provider: external:claude_code
    model: auto
```

This keeps the external agent as a role-bound participant. TomorrowEdge still owns the session, event ledger, trace export, and cockpit visibility.

`codex mcp-server` is supported as a real stdio MCP process when Codex CLI is installed and authenticated. Claude Code currently exposes MCP management/consumption commands in its CLI; if your Claude Code setup exposes a stdio MCP server or wrapper, configure that command and args in the same `external_agents.<id>.command` / `args` fields.

## Context and Recovery

When TomorrowEdge invokes an external MCP process, it sends structured workflow context:

- session id and goal
- routing assignments
- current plan/context/candidates/review/judge state
- role and prompt for the external agent

The ledger records:

- `external_agent_call` with `status=start`
- `external_agent_call` with `status=success` or `status=failure`
- `external_agent_result` when a result is returned
- `external_agent_error` when the process fails after retries

Configured `maxRetries`, `requestTimeoutMs`, and `startupTimeoutMs` bound long-running or failed external agents.

## Current Limits

- Real stdio MCP process invocation is supported through `command`, `args`, and `autoStart`.
- Codex CLI can be configured with `command: codex` and `args: [mcp-server]`.
- Claude Code requires a stdio MCP server command or wrapper on the local machine.
- Full live handoff to external CLIs should be added through adapters that preserve the same event ledger semantics.

## 中文说明

TomorrowEdge 不替代 Claude Code / Codex，而是把它们变成可分配角色的外部 agent，纳入一个可见、可审计、可回放的 multi-model cockpit。

Claude Code / Codex 给 agent full access；TomorrowEdge 给 full access 一个 cockpit。

外部 agent 可以负责 planner、coder、reviewer、judge、repairer，甚至可选的 core。TomorrowEdge 负责 workflow 编排、routing、trace、events.jsonl、session export 和 TUI 可视化监督。
