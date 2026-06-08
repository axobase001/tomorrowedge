# ADR: Encrypted API Key Storage

**Status:** proposed  
**Date:** 2026-06-08  
**Author:** ScourgeStorm1

## Context

v1.2.0 introduced a first-run SetupWizard that writes API keys to `.tomorrowedge/local.env`
(plaintext). While `.tomorrowedge/` is git-ignored, storing API keys as plaintext on disk
poses risks: accidental backup leakage, terminal history exposure, and visibility to any
process running under the same user account.

TomorrowEdge needs a secure credential storage mechanism that:

- Protects API keys at rest on disk
- Integrates seamlessly with the existing provider layer (no breaking changes)
- Works across Windows, macOS, and Linux without mandatory native dependencies
- Provides a GUI for users to manage keys without editing `.env` files by hand

## Decision

Implement a **layered SecretManager** with two backends:

### Primary: OS keychain (keytar)

Use the operating system's native credential store (macOS Keychain, Windows Credential
Manager, Linux Secret Service) via the `keytar` library. This is the same approach used by
VS Code's `SecretStorage`.

### Fallback: AES-256-CBC encrypted file

When keytar is unavailable (native module not installed), fall back to an encrypted file
at `~/.tomorrowedge/secrets.enc`.

**Encryption details:**

| Parameter | Value |
|-----------|-------|
| Algorithm | AES-256-CBC |
| Key derivation | scrypt (N=16384, r=8, p=1, keylen=32) |
| IV | Random 16 bytes per write |
| Format | `iv:encryptedData` (both hex) |
| Salt | Composite of service name + paths (bound to machine) |

### Storage schema

```json
{
  "deepseek": "sk-xxx",
  "openai": "sk-yyy",
  "anthropic": "sk-zzz"
}
```

Provider names map to `{PROVIDER}_API_KEY` environment variables at startup:
`"deepseek"` → `DEEPSEEK_API_KEY`.

### Priority when loading

```
shell env vars (highest, never overwritten)
  ↓
.env / .tomorrowedge/local.env
  ↓
~/.tomorrowedge/secrets.enc (lowest, only used if no other source set)
```

### Relationship with v1.2.0 setup/key flow

v1.2.0's SetupWizard writes keys to `local.env`. This ADR does not remove that path —
it adds an **additional** secure storage option. The GUI Keys panel (`SecretPanel`)
writes to `secrets.enc`; SetupWizard continues to write to `local.env`. At startup, both
are loaded, with shell/env vars taking precedence.

### Masking

Keys are never logged in full. The `maskKey()` function renders `sk-1234567890abcdef` as
`sk-12****cdef` in UI and logs.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        GUI Layer (SecretPanel)                       │
│  🔑 Keys button → add/edit/delete → PUT/DELETE /api/secrets/:prov   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                    Server Routes (server.ts)                         │
│  GET  /api/secrets          → listSecrets()                         │
│  PUT  /api/secrets/:prov    → saveSecret(provider, apiKey)          │
│  DELETE /api/secrets/:prov  → deleteSecret(provider)                │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                    SecretManager (secretManager.ts)                  │
│                                                                     │
│  saveSecret()                                                       │
│    ├── keytar (OS keychain)     ← primary (macOS/Linux)             │
│    └── AES-256-CBC encrypted    ← fallback (all platforms)          │
│         ~/.tomorrowedge/secrets.enc                                 │
│                                                                     │
│  getSecret()                                                        │
│    ├── keytar first, file fallback                                  │
│    └── returns plaintext for immediate use                          │
│                                                                     │
│  listSecrets(): returns { provider, configured, maskedKey }[]       │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                     (persisted on disk)
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│               Startup Integration (envLoader.ts)                     │
│                                                                     │
│  loadConfig() → loadLocalEnv() → loadSecretsIntoEnv()               │
│    │                                                                 │
│    │  decrypt secrets.enc → {"deepseek":"sk-xxx", ...}              │
│    │  map provider → uppercase env var name                         │
│    │  inject into process.env (only if not already set)             │
│    │                                                                 │
│    ▼                                                                 │
│  process.env.DEEPSEEK_API_KEY = "sk-xxx"                            │
│  process.env.OPENAI_API_KEY    = "sk-yyy"                           │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                   Provider Layer (registry.ts)                       │
│                                                                     │
│  providerKey(config, "deepseek") → process.env.DEEPSEEK_API_KEY     │
│  providerKey(config, "openai")   → process.env.OPENAI_API_KEY       │
│                                                                     │
│  No changes to existing provider code required.                     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                        External LLM APIs                             │
│                                                                     │
│  deepseek.ts  → Authorization: Bearer sk-xxx → DeepSeek API         │
│  anthropic.ts → x-api-key: sk-yyy            → Anthropic API        │
│  openaiCompatible.ts → Authorization: Bearer sk-zzz → OpenAI API    │
└─────────────────────────────────────────────────────────────────────┘
```

### Module map

| Module | File | Role |
|--------|------|------|
| SecretPanel | `src/cockpit-web/src/components/SecretPanel.tsx` | GUI for CRUD operations |
| Secrets API | `src/cockpit-web/src/api.ts` | Frontend fetch functions |
| Server routes | `src/localCockpit/server.ts` | Nonce-protected REST endpoints |
| SecretManager | `src/core/secretManager.ts` | AES-256 encryption, keytar fallback, masking |
| Env loader | `src/config/envLoader.ts` | Startup decryption → `process.env` |
| Provider registry | `src/providers/registry.ts` | `providerKey()` reads from `process.env` |

## Consequences

### Positive

- API keys are never stored as plaintext on disk
- No changes required to existing provider code (keys injected into `process.env`)
- Graceful degradation: missing/corrupted file → empty config, no crash
- Cross-platform: keytar where available, encrypted file everywhere

### Negative

- After decryption, keys exist in `process.env` as plaintext (same as all Node.js apps)
- scrypt salt is derived from deterministic inputs (file paths), not a random secret
  — acceptable for local-only threat model, but not for multi-user server deployments
- Dual storage (local.env + secrets.enc) may confuse users about which source is active

### Risks

- If `~/.tomorrowedge/secrets.enc` is deleted, keys are lost (user must re-enter them)
- If the scrypt derivation inputs change (username/home path changes), existing file
  cannot be decrypted — treated as corrupted, returns empty config
