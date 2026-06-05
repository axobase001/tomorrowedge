# Release

TomorrowEdge is not ready for a public production release yet, but the package
surface is prepared for dry-run validation.

Release checklist:

1. Run `npm run verify` for the normal local gate.
2. Run `npm run release:verify` before tagging or publishing.
3. Confirm `.env`, `.tomorrowedge/sessions`, `.tomorrowedge/undo`, and generated
   image output are not included in the package.
4. Run `tedge doctor`.
5. Optional: run `tedge models --real-smoke` with local keys.

`npm run verify` executes `npm test`, `npm run build`, `npm run secrets:scan`,
`npm audit --audit-level=high`, and `npm run pack:dry`.

`npm run pack:dry` warns about package-relevant untracked files and continues so
ordinary local draft docs do not break everyday verification. `npm run
pack:dry:strict` and `npm run release:verify` fail on those files and are the
release cleanliness gate.

Package entrypoint:

```bash
tedge
```

The `files` whitelist in `package.json` includes `dist`, docs, README,
CHANGELOG, LICENSE, the release secret scan script, and the tiny local LM demo
source.
