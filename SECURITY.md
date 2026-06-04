# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in TomorrowEdge, please **do not** open a public issue.

Instead, send a report to the maintainers via GitHub's [private vulnerability reporting](https://github.com/axobase001/tomorrowedge/security/advisories/new) or email the details to the project maintainer.

We aim to acknowledge reports within 72 hours and provide an initial assessment within 5 business days.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.5.x   | ✅ Active          |
| 0.4.x   | ❌ End of life     |
| < 0.4   | ❌ End of life     |

## Security Model

TomorrowEdge is a **full-access agent cockpit**. Understanding its security boundaries is critical before deployment:

### Access Modes

| Mode         | Network | Patch | Shell | Repair | Risk Profile                    |
| ------------ | ------- | ----- | ----- | ------ | ------------------------------- |
| `restricted` | Offline | ❌    | ❌    | ❌     | Read-only, lowest risk          |
| `partial`    | Cloud   | ⚠️    | ⚠️    | ⚠️     | Requires per-action approval    |
| `full`       | Cloud   | ✅    | ✅    | ✅     | Full autonomy, highest risk     |

- **restricted**: No write access, no network. Safe for inspection and analysis.
- **partial**: Write actions permitted but require explicit user approval per action.
- **full**: All actions auto-approved. **Always run in a sandbox, clean git repo, or fixture workspace.**

### Shell Execution

- In `full` and `partial` modes, TomorrowEdge can execute shell commands through a **verification
  allowlist**.
- The default allowlist includes: `npm`, `node`, `npx`, `pnpm`, `yarn`, `python`, `pytest`, `tsx`,
  `vitest`, `jest`, `cargo`, `go`, `make`, `cmake`, `pip`, `bun`, `deno`.
- Shell metacharacters (`;`, `&`, `|`, `` ` ``, `$()`, etc.) are blocked.
- Dangerous executables (`rm`, `shutdown`, `reboot`, `curl`, `wget`, `bash`, `sh`) are blocked by
  default.
- Customize the allowlist in `.tomorrowedge/config.yaml` under `shell.verification_allowlist`.

### API Keys and Secrets

- API keys are configured via environment variables (never committed to the repo).
- `tedge doctor` checks for missing API keys and warns on misconfiguration.
- `npm run secrets:scan` runs a secret scanner over the working tree (excludes `.env*`, `.git`,
  `node_modules`).
- The `.tomorrowedge/` directory is in `.gitignore` and contains session traces and artifacts.

### External Agent Bridge (MCP)

- External agents (Claude Code, Codex, etc.) connect via MCP over stdio (local process).
- External agents are registered with an explicit `trustLevel` and `allowedRoles`.
- All external agent actions (patch proposals, reviews, judgments, shell runs) are recorded in the
  event ledger.
- Review the `tedge mcp agents` list and `external_agents` config before enabling external agents.

### Telemetry

- Telemetry is **disabled by default** (`project.telemetry: false`).
- No usage data, prompts, or traces are sent to any server unless explicitly enabled.

## Best Practices

1. **Use fixture mode for testing**: `tedge run "task" --fixture-mode` operates on a temporary
   workspace copy.
2. **Review traces**: `tedge trace latest --verbose` shows every model call, patch, shell command,
   and review.
3. **Export and audit**: `tedge export latest --format markdown` produces a full audit trail.
4. **Prefer partial mode**: Only use `full` mode in sandboxed or disposable environments.
5. **Keep TomorrowEdge updated**: Check `CHANGELOG.md` for security-relevant fixes in each release.

## Disclosure Timeline

We follow responsible disclosure:
- 72 hours: Initial acknowledgment
- 5 business days: Triage and severity assessment
- 30 days: Patch prepared (shorter for critical issues)
- Public disclosure coordinated with fix availability

## Acknowledgments

We appreciate the security research community's help in keeping TomorrowEdge safe. Researchers who
follow this policy will be acknowledged in release notes (unless they request anonymity).
