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

First-run model discovery is recommendation-only:

```yaml
model_discovery:
  recommended_provider: openrouter
  refresh_free_models: true
  prefer_free_onboarding: true
  free_model_limit: 10
```

Use `tedge models --refresh-free` to query OpenRouter's live catalog for free
or low-cost onboarding candidates. Use
`tedge models --configure-free <model-id> --free-first` only after choosing a
model you want to write into `.tomorrowedge/config.yaml`.

After adding an API key, use `tedge models --connection-test` to verify that
enabled provider endpoints return HTTP 2xx from `/models` before running any
chat completion smoke test.

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
- Use OpenRouter as the easiest onboarding provider when users do not yet want
  to collect several direct provider keys.
- Prefer separate API keys per provider/account for cost tracking,
  rate-limit isolation, and debugging.
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
    cwd: /path/to/workspace
    proxyPort: 7890
    env:
      NODE_ENV: development
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

`proxyPort` is optional. When set, TomorrowEdge starts that MCP process with
`HTTP_PROXY`, `HTTPS_PROXY`, and `ALL_PROXY` pointing at
`http://127.0.0.1:<proxyPort>`. Values in `env` still take final precedence.

Use `tedge mcp agents --probe` to verify that configured commands start and
return MCP tools. Use `tedge mcp invoke <agent-id> --session latest --role
reviewer --prompt "..."` to call a configured external MCP process and record
the call/result/error in the current session.

For command runner adapters, TomorrowEdge passes a structured JSON request on
stdin and writes the same payload to a temp file exposed as
`TOMORROWEDGE_EXTERNAL_CONTEXT_FILE`. stdout and stderr are captured into the
event ledger as artifacts.

## Shell policy

Shell policy is separate from access mode:

```yaml
shell:
  policy: unrestricted # unrestricted | verification_allowlist | approval_required
  verification_allowlist:
    - npm
    - node
    - cargo
    - rustc
    - make
    - cmake
    - go
    - uv
    - pip
    - bun
    - deno
```

Defaults:

- `restricted`: shell is disabled by access approval state.
- `partial`: shell requires explicit approval.
- `full`: shell is `unrestricted` by default and fully logged.
- CI/demo lanes can set `shell.policy: verification_allowlist` to constrain
  verification commands without changing full-access semantics.

`unrestricted` means unrestricted executable invocation, not raw shell-script
execution. TomorrowEdge still splits the command into an executable plus args
and runs it with `shell: false`; shell metacharacters such as `&&`, pipes,
redirects, backticks, and newlines are blocked.

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
