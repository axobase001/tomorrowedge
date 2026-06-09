# Core-Led Workflow

`tedge workflow` runs the full cockpit pattern:

1. Core Planner creates a task decomposition, acceptance criteria, roles, and safety rules.
2. Different providers debate the plan before execution.
3. Core assigns different model roles and deliverables.
4. Models execute non-mutating deliverables.
5. Core Reviewer audits quality and writes a replayable report.

Example:

```bash
tedge workflow "design and land a real multi-model orchestration workflow" --providers openrouter,deepseek,mimo
tedge workflow "design and land a real multi-model orchestration workflow" --providers openrouter,deepseek,mimo --rounds 2
```

Default role preferences:

- Core Planner/Reviewer: local River/TomorrowEdge
- Architect/Judge: OpenRouter, then Kimi/DeepSeek/OpenAI-compatible/MiMo/local/mock
- Implementation Agent: DeepSeek, then Kimi/OpenAI-compatible/OpenRouter/MiMo/local/mock
- Docs/UX Agent: MiMo, then Kimi/OpenRouter/DeepSeek/OpenAI-compatible/local/mock

`--providers` is treated as the allowed provider set. If a preferred provider is
not available, TomorrowEdge reassigns that workflow role to the closest
available provider instead of emitting `Provider unavailable` for the role.

The command saves a Markdown report under `.tomorrowedge/workflows/`.
It does not apply patches or run shell commands proposed by models.

## Workflow Recipes

`tedge recipes` lists built-in coding workflow recipes. Recipes are not generic
personal-agent skills; they are narrow starting points for patch/test/review
cockpit runs.

```bash
tedge recipes
tedge run --recipe review-only
tedge run --recipe bugfix-sprint "fix the failing auth test"
tedge run --recipe security-audit "review the current login changes"
```

Available recipes:

- `review-only`: inspect repository/diff state without applying patches.
- `bugfix-sprint`: generate candidates, review, verify, and enable repair.
- `security-audit`: run conservative red-team review and judge gating.

`--rounds` accepts 1-5 debate rounds. Round 1 collects role-specific arguments.
Later rounds are cross-examination rounds over the prior transcript:

- Architect/Judge identifies contradictions and approval gates.
- Implementation Agent responds to risks and refines landing order.
- Docs/UX Agent challenges unclear Chinese operator UX and cockpit copy.

Each live debate or execution batch is preflighted against
`debate.max_cost_usd`. If configured prices show the batch would exceed the
remaining budget, the workflow stops further model calls, records
`budgetStatus`, and the Core Review reports `needs_revision`.
