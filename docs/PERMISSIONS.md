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
tedge run "fix failing test" --headless --provider fixture --approve-patch --approve-shell
```

Omit either flag to keep that action blocked.

Undo snapshots are created before patch writes:

```bash
tedge undo --list
tedge undo
tedge undo --snapshot <id>
```
