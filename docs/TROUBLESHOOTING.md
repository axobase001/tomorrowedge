# Troubleshooting

## Start With The Offline Path

Before configuring paid providers, verify the local cockpit path:

```bash
npm install
npm test
npm run dev -- doctor
npm run dev -- run "fix failing test" --headless --fixture-mode
```

If this fails, fix the local Node or repository setup before adding API keys.

## Provider Key Works In Shell But TomorrowEdge Says Missing Env

TomorrowEdge reads `.env` from the current workspace and then checks the
configured `providers.<id>.api_key_env`.

Check:

```bash
npm run dev -- config
npm run dev -- doctor
npm run dev -- models --connection-test
```

Make sure the config references the exact env var name you set. Prefer one key
per provider or account so rate limits, cost tracking, and failures stay
separable.

## Connection Test Fails

`tedge models --connection-test` sends a lightweight catalog request:

- OpenAI-compatible providers: `GET <base_url>/models`
- Anthropic: `GET https://api.anthropic.com/v1/models`
- Gemini: `GET https://generativelanguage.googleapis.com/v1beta/models`

Common fixes:

- Confirm `base_url` has no trailing path such as `/chat/completions`.
- Confirm the provider key belongs to the selected endpoint or region.
- For MiMo Token Plan keys, use the Token Plan cluster URL from the subscription
  page, such as `token-plan-cn`, `token-plan-sgp`, or `token-plan-ams`.
- Run a provider-scoped check: `tedge models --connection-test --provider openrouter`.

## Anthropic Or Gemini Is Enabled But Not Selected

Native adapters exist for both providers, but routing still depends on role
profiles and explicit assignments. To force a role:

```yaml
agents:
  reviewer:
    provider: anthropic
    model: claude-sonnet-4-5
  vision:
    provider: gemini
    model: gemini-2.5-pro
```

For cheaper onboarding, keep OpenRouter as the default provider and bind native
Claude/Gemini only to high-value review, judge, or vision roles.

## Full Mode Feels Too Powerful

That is intentional. `full` means patch, shell, and repair can run without
per-step approval. Use it in a clean repo, fixture, sandbox, or disposable
branch.

Safer alternatives:

```bash
tedge mode restricted
tedge mode partial
tedge run "task" --access-mode partial
```

For CI demos, set:

```yaml
shell:
  policy: verification_allowlist
```

## MCP Agent Does Not Respond

Use diagnostics first so command and cwd problems are caught before spawning
external processes:

```bash
tedge mcp agents --diagnose
tedge mcp agents --probe
```

Then invoke one role manually:

```bash
tedge mcp invoke codex --session latest --role reviewer --prompt "review the latest trace"
```

If auto tool selection fails, pass `--tool <tool-name>` explicitly. External
agent stdout, stderr, result refs, and errors are recorded as
`external_agent_*` events.

## Chinese Markdown Looks Corrupted In Windows Tools

Workflow reports are written as UTF-8 with BOM for friendlier Windows markdown
viewers. If a terminal display still looks garbled, open the file in an editor
that detects UTF-8, or run:

```bash
npm run dev -- export latest --format markdown
```

## Release Zip Or Tarball Fails Secret Scan

`npm run secrets:scan` works in git checkouts and non-git release archives. It
falls back from `git ls-files` to `fast-glob` and skips binary assets, docs
screenshots, tests fixtures, `node_modules`, `dist`, and `.tomorrowedge`.

Run the full release gate:

```bash
npm run verify
```
