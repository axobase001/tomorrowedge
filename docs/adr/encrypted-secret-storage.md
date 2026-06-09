# ADR: Encrypted Provider Secret Storage

**Status:** implemented for encrypted local files; OS keychain remains planned
**Date:** 2026-06-10

## Context

Early GUI setup wrote provider API keys to `.tomorrowedge/local.env`. The config
file only stored `api_key_env`, so raw keys stayed out of YAML, but the GUI write
path still created plaintext secrets on disk.

TomorrowEdge needs provider setup that keeps onboarding simple while reducing
accidental plaintext exposure. Existing `.env` and `.tomorrowedge/local.env`
loading must remain backward compatible for users who already manage secrets
outside the cockpit.

## Decision

The GUI setup and Keys panel now write pasted provider keys to:

```text
.tomorrowedge/secrets.enc
```

The file is an authenticated encrypted JSON envelope:

| Field | Value |
| --- | --- |
| Cipher | `aes-256-gcm` |
| KDF | `scrypt` |
| Salt | random per write |
| IV | random per write |
| Auth tag | stored separately |
| File mode | `0600` where the platform honors it |

The encryption key is derived from `TOMORROWEDGE_SECRET_PASSPHRASE` when it is
set. Otherwise it is derived from local machine/user/project identity. That
fallback protects against casual copy/leakage of the encrypted file, but it is
not a replacement for a native OS credential store.

## Load Priority

Provider keys are loaded in this order:

```text
shell environment variables
.env
.tomorrowedge/local.env
.tomorrowedge/secrets.enc
```

Later layers never overwrite values already present in `process.env`. This keeps
existing shell and CI configurations authoritative.

## Runtime Contract

- Config continues to store only provider metadata and `api_key_env`.
- Provider code still reads keys through `process.env`.
- GUI status can report `env`, `local_env`, `encrypted_file`, `not_required`, or
  `missing`.
- Removing a provider key deletes the encrypted record and also removes the
  matching legacy `local.env` entry when present.
- Raw keys are never returned to the browser after saving; status uses masked
  values only.

## OS Keychain Status

Native keychain storage is still a future enhancement. A production-grade
cross-platform implementation should use Windows Credential Manager, macOS
Keychain, and Linux Secret Service, with the encrypted file as fallback. The
current implementation intentionally avoids mandatory native dependencies so the
release package, CI, and Windows local setup stay reliable.

## Validation

- `tests/unit/secretManager.test.ts`
- `tests/unit/localCockpit.test.ts`
- `npm run secrets:scan`
