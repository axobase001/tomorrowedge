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

If a bound is reached, TomorrowEdge emits an `autonomy_limit_reached` event and
stops that part of the autonomous loop.

Local learned task memory is stored in `.tomorrowedge/task-memory.jsonl` after
sessions are saved. It records compact metadata only: task type, risk level,
routing mode, verification commands, visual page type, judge decision, and
result. It does not store file contents or long model outputs.
