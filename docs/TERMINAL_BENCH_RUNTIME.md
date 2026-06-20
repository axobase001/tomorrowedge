# Terminal-Bench 2.1 Runtime

TomorrowEdge's Terminal-Bench support is a benchmark adapter for Harbor plus a first-class terminal action runtime.

It is not an official Terminal-Bench score claim by itself. A score is only reportable after Harbor completes the requested dataset split with the TomorrowEdge agent and the produced `results.json` / job artifacts.

## Runtime Contract

The model does not receive an unconstrained shell prompt. It must return a structured terminal action:

```json
{
  "thought": "short execution reason",
  "files": [{ "path": "/app/solve.py", "content": "..." }],
  "commands": ["python3 /app/solve.py"],
  "verify": true,
  "done": false
}
```

TomorrowEdge then records:

- generated file uploads,
- command policy decisions,
- command stdout/stderr projections,
- hard-gate verifier results,
- repeated-failure escalation hints.

The raw runtime artifacts stay in Harbor job output and TomorrowEdge trace metadata. Model-visible observations are compacted before the next action.

## Hard Gate

For Terminal-Bench compressor-style tasks, the adapter uses a deterministic verifier:

```sh
/app/decomp < /app/data.comp > /tmp/tbench.out
cmp -s /tmp/tbench.out /app/data.txt
```

Failure is classified as:

- `no_file`
- `size_fail`
- `crash`
- `output_mismatch`
- `timeout`
- `fail`
- `unknown`

Checker confidence or model self-report cannot override this hard gate.

## CLI

Show the runtime contract and canonical command:

```sh
tedge tbench runtime
```

Run a one-task smoke through Harbor:

```sh
tedge tbench smoke --quiet
```

Run with explicit multi-model routing and hard strong-agent intervention:

```sh
tedge tbench smoke --quiet \
  --primary-model deepseek/deepseek-chat-v3.1 \
  --advisor-model moonshotai/kimi-k2.7-code \
  --strong-model z-ai/glm-5.1 \
  --escalation-after 3 \
  --max-strong-interventions 3 \
  --max-steps 20 \
  --strong-max-tokens 4000 \
  --agent-timeout-multiplier 2 \
  --require-strong
```

`--require-strong` means a configured strong intervention must return an executable JSON action. If the strong model only returns prose, TomorrowEdge records the raw excerpt and fails the trial instead of silently continuing as if the intervention succeeded.
Use `--agent-timeout-multiplier` when testing long-reasoning model teams; Harbor's default agent timeout can otherwise stop a valid but slow run before final metadata is written.

Dry-run the Harbor command:

```sh
tedge tbench smoke --dry-run --quiet
```

Equivalent Harbor command:

```sh
harbor run \
  -d terminal-bench/terminal-bench-2-1 \
  -a tomorrowedge-canopus \
  --agent-import-path scripts.tbench.tomorrowedge_harbor_agent:TomorrowEdgeHarborAgent \
  -l 1 \
  -n 1 \
  -y \
  -q \
  -o .tomorrowedge/tbench/jobs \
  --job-name tb21-tomorrowedge-smoke
```

## Environment

The Harbor adapter reads provider credentials from the process environment or local `.env` without printing secrets. Set the OpenRouter credential in your shell or ignored local env file before running a live job:

```sh
export OPENROUTER_API_KEY
```

Optional model overrides:

```sh
TBENCH_PRIMARY_MODEL=deepseek/deepseek-chat-v3.1
TBENCH_ADVISOR_MODEL=moonshotai/kimi-k2.7-code
TBENCH_STRONG_MODEL=z-ai/glm-5.1
TBENCH_MAX_STEPS=20
TBENCH_STRONG_MAX_OUTPUT=4000
```

## Strategy Profiles

The advisor stage now returns `task_profile` and `strategy_protocol` in addition to evidence questions. For tasks that ask for an encoder, compressor, or crafted input matching a provided decoder/decompressor, the preferred profile is:

```text
task_profile: reverse_engineer_matching_decoder
strategy_protocol: translate_verify_reverse
```

This tells the execution agent to avoid a from-scratch standard encoder. The expected path is: translate the decoder or decompressor as faithfully as possible, verify that translation against the original on small probes, then reverse the same state machine and repair against the hard gate.

## Current Boundary

This runtime is designed to make Terminal-Bench execution auditable and reproducible. It does not turn a one-task smoke into an official score, and it does not hide failed verifier output behind model claims.
