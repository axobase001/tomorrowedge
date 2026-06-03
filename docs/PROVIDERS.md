# Providers

API keys are never hardcoded. Use environment variables:

```bash
OPENAI_API_KEY=
OPENROUTER_API_KEY=
MIMO_API_KEY=
DEEPSEEK_API_KEY=
KIMI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
OPENROUTER_MODEL=openai/gpt-5.2
MIMO_MODEL=mimo-v2.5-pro
DEEPSEEK_MODEL=deepseek-v4-pro
OPENAI_COMPATIBLE_MODEL=gpt-4o-mini
KIMI_MODEL=kimi-k2.6
OLLAMA_MODEL=local-auto
OPENROUTER_INPUT_PRICE_PER_MTOK=
OPENROUTER_OUTPUT_PRICE_PER_MTOK=
MIMO_INPUT_PRICE_PER_MTOK=
MIMO_OUTPUT_PRICE_PER_MTOK=
DEEPSEEK_INPUT_PRICE_PER_MTOK=
DEEPSEEK_OUTPUT_PRICE_PER_MTOK=
OLLAMA_BASE_URL=http://localhost:11434
```

The CLI automatically loads a local `.env` file from the current workspace.
`.env` is ignored by git and must not be committed.

Current configured endpoints:

- OpenRouter: `https://openrouter.ai/api/v1`
- DeepSeek: `https://api.deepseek.com`
- Kimi/Moonshot: `https://api.moonshot.ai/v1` with default model `kimi-k2.6`
- Xiaomi MiMo Token Plan OpenAI-compatible: `https://token-plan-sgp.xiaomimimo.com/v1`

MiMo has two key families:

- `sk-...` pay-as-you-go keys use `https://api.xiaomimimo.com/v1`
- `tp-...` Token Plan subscription keys use a Token Plan cluster URL shown on the subscription page

Known Token Plan cluster URLs:

- China: `https://token-plan-cn.xiaomimimo.com/v1`
- Singapore: `https://token-plan-sgp.xiaomimimo.com/v1`
- Europe: `https://token-plan-ams.xiaomimimo.com/v1`

Run a tiny live connectivity check:

```bash
tedge models --real-smoke
tedge models --smoke-suite
```

Live advisory sessions always record token usage. If `*_PRICE_PER_MTOK`
variables are configured, session JSON and the TUI memory pane also show an
estimated USD cost.

Before live advisory calls, TomorrowEdge estimates prompt/output cost against
`routing.max_cost_usd`. If all involved provider prices are known and the
estimate exceeds the configured budget, the live calls are blocked before any
provider request is sent. If a provider price is unknown, the session is marked
`price_unknown` and token usage is still recorded after the call.

When `routing.fallback=true`, live advisory and live patch calls fall back to
the offline mock provider if the routed provider is enabled in config but is not
available at runtime, for example because a key is missing. The fallback is
recorded in `modelNotes`; it is not treated as a successful call from the
original provider.

`--smoke-suite` reports text, JSON, and likely multimodal vision checks for
configured cloud providers. Failures are printed per provider/model instead of
throwing, so CI or local setup can distinguish "provider unavailable" from a
broken TomorrowEdge runtime.

Default CI uses `mock` and `fixture` only.

## Compatibility matrix

Mainstream API compatibility is controlled in `.tomorrowedge/config.yaml`.

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
  deepseek:
    enabled: true
    api_key_env: DEEPSEEK_API_KEY
    base_url: https://api.deepseek.com
    model: deepseek-v4-pro
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
  kimi:
    enabled: true
    api_key_env: KIMI_API_KEY
    base_url: https://api.moonshot.ai/v1
    model: kimi-k2.6
    api_format: openai_chat
    auth_header: bearer
    extra_headers: {}
  openai_compatible:
    enabled: true
    api_key_env: OPENAI_API_KEY
    base_url: https://api.openai.com/v1
    model: gpt-4o-mini
    api_format: openai_chat
    auth_header: bearer
    extra_headers: {}
  ollama:
    enabled: true
    base_url: http://localhost:11434
    model: llama3.1
    api_format: openai_chat
    auth_header: none
    extra_headers: {}
```

Supported provider adapter switches:

- `api_format: openai_chat` sends `max_completion_tokens`.
- `api_format: legacy_chat` sends `max_tokens` for older OpenAI-compatible APIs.
- `auth_header: bearer` sends `Authorization: Bearer <key>`.
- `auth_header: api-key` sends `api-key: <key>`, useful for MiMo token-plan clusters.
- `auth_header: none` allows local or unauthenticated OpenAI-compatible endpoints.
- `extra_headers` can carry provider-specific headers such as OpenRouter app metadata.

Provider defaults are only starter values. For experiments, change
`providers.<id>.model` and `agents.<role>.provider/model` directly in config.
