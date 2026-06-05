# Benchmark Demo

Run the no-key public benchmark demo:

```bash
tedge benchmark-demo --output markdown
tedge benchmark-demo --output json
```

The demo compares three deterministic strategies on the fixture repair task:

- Strong single model: one high-capability route owns planning, coding, review,
  judge, and summary.
- Cheap single model: one low-cost route owns the whole workflow without the
  repair loop.
- TomorrowEdge multi-role workflow: stronger routes plan/review/judge while
  cheaper execution lanes code and repair under the event ledger.

Reported metrics:

- quality score,
- estimated cost in USD,
- elapsed time,
- trace completeness,
- repair attempts,
- final result.

The benchmark writes a markdown report to `.tomorrowedge/benchmarks/`.

This is a reproducible product demo, not a live provider leaderboard. It uses
offline fixture execution and cost estimates from configured provider defaults
so users can inspect the quality/cost/trace shape without API keys or live model
rate limits.
