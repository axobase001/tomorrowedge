# Routing

Routing modes:

- `cheap`
- `balanced`
- `quality`
- `local`
- `privacy`
- `china`

The router assigns models per role. Strong models are intended for planning and judging; efficient models for exploration and implementation; local models for privacy.

When real providers are enabled in `.tomorrowedge/config.yaml`, routing builds
profiles from config before falling back to offline defaults:

- Planner, Reviewer, Judge: OpenRouter GPT-5 class model by default
- Explorer, Coder-A, Repairer, Summarizer: DeepSeek by default
- Coder-B and secondary Chinese/multilingual slots: MiMo when configured
- Runner: always local tool, never an LLM provider

This keeps the product principle visible in cockpit state:

```text
Strong models plan and judge.
Efficient models explore and implement.
Local tools run only after human approval.
```

`--live-advisory` uses the same route assignments for non-mutating model notes:

- `planner`, `reviewer`, `judge` notes come from the strong-model route
- `coder_a` implementation notes come from the efficient implementation route
- notes are stored in `modelNotes` and shown in session JSON/TUI memory
- advisory output never applies patches and never runs shell commands

## Fallback

Every non-mock assignment gets an offline mock fallback in the routing plan. If
a live advisory or live patch call cannot find the configured provider, or the
provider call fails, TomorrowEdge tries the fallback when `routing.fallback` is
true.

Fallback is visible, not silent:

- `modelNotes[].provider` and `modelNotes[].model` show the provider that actually answered
- `modelNotes[].fallbackUsed` is true when fallback handled the call
- `modelNotes[].fallbackFrom` records the failed primary route
- `modelNotes[].fallbackReason` records why the primary route failed

Set `routing.fallback=false` to surface the primary provider error without
trying the offline fallback.
