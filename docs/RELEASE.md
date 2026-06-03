# Release

TomorrowEdge is not ready for a public production release yet, but the package
surface is prepared for dry-run validation.

Release checklist:

1. Run `npm test`.
2. Run `npm run build`.
3. Run `npm audit --json`.
4. Run `npm run pack:dry`.
5. Confirm `.env`, `.tomorrowedge/sessions`, `.tomorrowedge/undo`, and generated
   image output are not included in the package.
6. Run `tedge doctor`.
7. Optional: run `tedge models --real-smoke` with local keys.

Package entrypoint:

```bash
tedge
```

The `files` whitelist in `package.json` includes only `dist`, docs, README, and
LICENSE.
