# Config

Run:

```bash
tedge init
```

This creates:

```text
.tomorrowedge/config.yaml
```

The default config enables safe mode, disables telemetry, and leaves cloud providers off unless configured.

`tedge init` never overwrites an existing config. Use `tedge init --force` only
when you intentionally want to replace the current config with defaults.

Project preferences are inspectable with `tedge prefs`; use
`tedge prefs --list-keys` for available keys and `tedge prefs --json` for raw
machine-readable output.

## Orchestration backend

TomorrowEdge defaults to the native agent graph:

```yaml
orchestration:
  backend: native
```

The config schema also reserves adapter slots for `langgraph`, `crewai`, and
`autogen`, plus MCP tool bridging. These adapters are placeholders in 0.2.x and
raise clear unavailable-backend errors if selected before implementation.

See [ORCHESTRATION_BACKENDS.md](ORCHESTRATION_BACKENDS.md).

## Model and role configuration

TomorrowEdge does not require hardcoded model ownership. Providers define how to
call a model API; agents define which provider/model should own a role. Leave
either field as `auto` to let the router choose.

```yaml
providers:
  openrouter:
    enabled: true
    api_key_env: OPENROUTER_API_KEY
    base_url: https://openrouter.ai/api/v1
    model: openai/gpt-5.2
    api_format: openai_chat
    auth_header: bearer
    extra_headers: {}
  mimo:
    enabled: true
    api_key_env: MIMO_API_KEY
    base_url: https://token-plan-sgp.xiaomimimo.com/v1
    model: mimo-v2.5-pro
    api_format: openai_chat
    auth_header: api-key
    extra_headers: {}

agents:
  vision:
    provider: mimo
    model: mimo-v2.5-pro
  planner:
    provider: openrouter
    model: openai/gpt-5.2
  coder_a:
    provider: deepseek
    model: deepseek-v4-pro
  reviewer:
    provider: openrouter
    model: anthropic/claude-opus-4.1
```

Recommended experiment pattern:

- Keep `runner` local; it is a tool route, not a model route.
- Use strong models for `planner`, `reviewer`, and `judge`.
- Use efficient coding models for `explorer`, `coder_a`, `coder_b`, and `repairer`.
- Use a vision-capable model for `vision` when screenshot/image tasks are tested.
- Use `ollama` for roles that must stay local in privacy experiments.
- In `privacy` or `local` routing mode, cloud role overrides are ignored and routed to local-safe providers.

## External MCP agents

TomorrowEdge can bind external coding agents such as Claude Code or Codex to
workflow roles through the MCP Agent Bridge:

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
    requestTimeoutMs: 60000
    maxRetries: 1
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

`core` is optional. It appears in routing only when explicitly bound. External
agents are visible in the TUI, and their patch/review/judgment/result
submissions are written to `events.jsonl`.

Use `tedge mcp agents --probe` to verify that configured commands start and
return MCP tools. Use `tedge mcp invoke <agent-id> --session latest --role
reviewer --prompt "..."` to call a configured external MCP process and record
the call/result/error in the current session.

## Autonomy and budget bounds

Full mode is autonomous execution, so it uses run boundaries instead of
per-step confirmation:

```yaml
autonomy:
  max_iterations: 5
  max_repairs: 3
  max_shell_runs: 10
  max_cost_usd: 10
  max_wall_time_sec: 1800

budget:
  hard_cap_usd: 10
  warn_at_percent: 80
```

Currently enforced bounds: `max_repairs` and `max_shell_runs`. Cost and wall
time are estimated and reported, but `max_iterations`, `max_cost_usd`, and
`max_wall_time_sec` are planned enforcement points for the next autonomous loop
upgrade.

Local learned task memory is stored in `.tomorrowedge/task-memory.jsonl` after
sessions are saved. It records compact metadata only: task type, risk level,
routing mode, verification commands, visual page type, judge decision, and
result. It does not store file contents or long model outputs.
