# Agent Drill

`tedge drill` runs a non-mutating multi-model capability drill.

TomorrowEdge acts as the core planner/reviewer:

- defines the task and expected files
- sends the same fixture context to selected providers
- asks each provider for a JSON patch candidate
- scores each candidate with one local rubric
- reports winner, strengths, weaknesses, usage, and budget status

Example:

```bash
tedge drill "fix the failing add test" --fixture sample-repo-basic --providers openrouter,deepseek,mimo
```

The command does not apply patches, run tests, or mutate the fixture.

Current local rubric:

- parseable JSON
- concrete unified diff
- expected behavior change
- minimal target file
- runnable verification command
- low-risk classification
