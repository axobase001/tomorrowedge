# Release

TomorrowEdge is not ready for a public production release yet, but the package
surface is prepared for dry-run validation.

Release checklist:

1. Run `npm run verify`.
2. Confirm `.env`, `.tomorrowedge/sessions`, `.tomorrowedge/undo`, and generated
   image output are not included in the package.
3. Run `tedge doctor`.
4. Optional: run `tedge models --real-smoke` with local keys.

`npm run verify` executes `npm test`, `npm run build`, `npm run secrets:scan`,
`npm audit --audit-level=high`, and `npm run pack:dry`.

Package entrypoint:

```bash
tedge
```

The `files` whitelist in `package.json` includes `dist`, docs, README,
CHANGELOG, LICENSE, the release secret scan script, and the tiny local LM demo
source.
