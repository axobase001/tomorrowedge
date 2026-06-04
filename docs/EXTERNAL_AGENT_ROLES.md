# External Agent Roles

External agents are coding agents that connect to TomorrowEdge through MCP and take specific workflow roles. They are not generic chat participants. They are role-bound workers whose actions must be visible in the event ledger.

## Optional Core Role

`core` is an optional strong-agent role:

- high-level orchestration
- overall task ownership
- final strategy supervision
- deciding when to ask for human authorization

Not every workflow needs `core`. TomorrowEdge only includes it in routing when the user explicitly binds it.

## Recommended Role Mapping

| Role | Good external fit | Notes |
| --- | --- | --- |
| `core` | Claude Code / Codex / strong reasoning model | Optional owner role. |
| `planner` | Claude Code / strong reasoning model | Builds plan and risk framing. |
| `coder_a` | Codex / fast coding model | Produces patch candidates. |
| `coder_b` | Alternate coding agent | Produces competing patch candidates. |
| `reviewer` | Claude Code / Codex / Opus-class reviewer | Finds risks and missing tests. |
| `judge` | Strong reasoning model | Selects, rejects, or asks user. |
| `repairer` | Codex / efficient coding model | Repairs after failed tests. |

## Profile Shape

```ts
type ExternalAgentProfile = {
  id: string;
  name: string;
  transport: "mcp";
  capabilities: string[];
  allowedRoles: AgentRole[];
  trustLevel: "low" | "medium" | "high" | "owner";
  costProfile?: Record<string, unknown>;
  notes?: string;
};
```

## Visibility Rules

Every external agent handoff should become trace data:

- registration is `external_agent_registered`
- tool/handoff start and completion is `external_agent_call`
- generic output is `external_agent_result`
- patch output is `external_agent_patch_candidate`
- review output is `external_agent_review`
- judge output is `external_agent_judgment`
- errors are `external_agent_error`
- usage is `external_agent_cost_usage`

The TUI shows external agents with an `EXTERNAL` badge, the router shows `role -> external:<id>`, and trace panes highlight `external_agent_*` events.

## 中文说明

外部 agent 是通过 MCP 接入 TomorrowEdge 的 Claude Code、Codex 或其他 coding agent。它们不是来替代 TomorrowEdge 的，而是被 TomorrowEdge 分配到具体 workflow role 里。

TomorrowEdge 的边界：

- 外部 agent 可以写代码、审查、裁决或修复。
- TomorrowEdge 负责角色绑定、编排、事件账本、trace、导出和 TUI 监督。
- 外部 agent 不能只给最终答案，必须留下可审计轨迹。
