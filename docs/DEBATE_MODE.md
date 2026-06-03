# Debate Mode

Debate mode compares candidate patches from Coder-A and Coder-B, then reviewer scoring and judge selection decide whether a patch should be selected or revised.

Budgets are capped by config:

```yaml
debate:
  enabled: true
  max_candidates: 2
  max_rounds: 1
  max_cost_usd: 1.00
  max_wall_time_sec: 300
```
