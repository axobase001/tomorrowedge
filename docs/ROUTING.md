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

These are defaults, not a fixed product rule. Users and test subjects can
override any model-owned role with:

```yaml
agents:
  planner:
    provider: openrouter
    model: openai/gpt-5.2
  coder_a:
    provider: deepseek
    model: deepseek-v4-pro
  vision:
    provider: mimo
    model: mimo-v2.5-pro
```

Set `provider: auto` or `model: auto` to hand that part back to the router. If
only `model` is specified, TomorrowEdge tries to infer the provider from the
configured model profiles; otherwise it keeps the auto-selected provider and
uses the requested model string.

In `privacy` and `local` modes, cloud overrides are ignored and the route stays
local-safe. This lets experiments freely compare models in normal modes without
accidentally violating privacy-mode expectations.

## Strategy memory

By default, routing is deterministic and ignores learned memory. When
`memory.strategy_routing=true` or `tedge prefs --strategy-memory-routing true`
is set, TomorrowEdge reads recent `.tomorrowedge/task-memory.jsonl` summaries
for the matching task type and may:

- prefer provider/model pairs with successful recent outcomes,
- avoid provider/model pairs with recent `rate_limited`, `quota_exhausted`,
  `invalid_key`, or `invalid_model` failures,
- use the most common remembered verification command when the user did not
  pass `--test-command`.

Explicit `agents.<role>.provider/model` config still wins over memory. In
`privacy` and `local` modes, cloud memory suggestions are ignored by the same
privacy guard as manual overrides.

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
