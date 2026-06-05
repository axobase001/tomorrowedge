# Permissions

Safe mode is the default.

Approval is required for:

- applying patches
- running shell commands
- sending sensitive files to cloud models
- overriding privacy mode

The first implementation exposes the permission model and approval gate as core contracts.

Patch application also runs safety validation before approval can apply anything. It blocks path traversal, ignored targets, and sensitive target paths such as `.env` or private-key-like files.

In headless fixture runs, approvals are explicit flags:

```bash
tedge run "fix failing test" --headless --fixture-mode --approve-patch --approve-shell
```

Omit either flag to keep that action blocked.

Undo snapshots are created before patch writes:

```bash
tedge undo --list
tedge undo
tedge undo --snapshot <id>
```

## Shell policy

Access mode decides whether shell execution is approved. `shell.policy` decides
how approved shell commands are parsed and constrained:

```yaml
shell:
  policy: unrestricted # unrestricted | verification_allowlist | approval_required
```

- `restricted`: shell is disabled by access approval state.
- `partial`: shell requires explicit approval.
- `full`: shell is `unrestricted` by default and fully logged.
- `verification_allowlist`: useful for CI/demo lanes that should only run known
  verification commands.

`unrestricted` means unrestricted executable invocation, not raw shell-script
execution. TomorrowEdge parses the command into an executable plus args and
runs it with `shell: false`; shell metacharacters such as `&&`, pipes,
redirects, backticks, and newlines are blocked.
