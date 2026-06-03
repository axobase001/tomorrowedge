# Capability Stitching / 能力拼接式路由

TomorrowEdge routes capabilities, not just requests.

OpenRouter answers "how do I call many models?" TomorrowEdge answers "how do I
compose model capabilities into a supervised engineering workflow?"

## Core Idea

Many coding tasks are not pure text-to-code tasks. They combine perception,
repo exploration, implementation, review, verification, and authorization.
TomorrowEdge can insert a capability handoff when one model has a missing
ability.

```text
Image / Screenshot / Diagram
  -> Vision Agent
  -> Structured Visual Spec
  -> Planner / Coder
  -> Patch / Test
  -> Reviewer / Runner
```

Example:

```text
MiMo V2.5 reads the screenshot.
GPT-5.3 Spark / DeepSeek / Kimi writes the implementation.
TomorrowEdge owns the structured handoff and review trail.
```

## Current Implementation

`tedge run` accepts image inputs:

```bash
tedge run "restore this React page from the screenshot" --image ./screen.png --headless
```

When images are present, TomorrowEdge:

1. Adds `vision` to the routing plan.
2. Routes `vision` to a model with `vision` / `ocr` / `perception` tags.
3. Runs Vision Agent before Planner.
4. Emits a `StructuredVisualSpec`.
5. Adds the visual handoff to Planner, Coder, live advisory, and live patch prompts.
6. Records the capability route in session/headless output.

The offline Vision Agent creates a structured placeholder spec so tests and
TUI/session plumbing work without calling a real multimodal model. Live
multimodal provider calls can be added behind the same `vision` role later.

## Capability Tags

Routing can reason about:

- `vision`
- `ocr`
- `perception`
- `coding`
- `long_context`
- `reasoning`
- `review`
- `local`
- `cheap`
- `fast`

This turns model selection into capability composition:

```text
Input: screenshot + repo task

Vision Agent     MiMo V2.5        extracted UI spec
Planner          strong model     split implementation
Coder            efficient model  generated patch
Reviewer         strong model     checked visual risk
Runner           local            verified tests
```

## Product Claim

Do not choose one model to do everything. Compose the smallest capable model
team for the task.

OpenRouter routes requests. TomorrowEdge routes capabilities.
