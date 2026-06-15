# Release

TomorrowEdge is not ready for a public production release yet, but the package
surface is prepared for dry-run validation.

Release checklist:

1. Run `npm run verify:fast` while iterating locally on normal code changes.
2. Run `npm run verify` for the full local gate.
3. Run `npm run release:verify` before tagging or publishing.
4. Confirm `.env`, `.tomorrowedge/sessions`, `.tomorrowedge/undo`, and generated
   image output are not included in the package.
5. Run `tedge doctor`.
6. Optional: run `tedge models --real-smoke` with local keys.

`npm run verify:fast` executes build, web build, docs status, secret scan,
audit check, `test:core`, and `test:council`. It is intended for ordinary local
iteration.

`npm run verify` executes the full `npm test`, build, web build, docs status,
secret scan, audit check, and `pack:dry`. On a normal contributor laptop this is
expected to take longer than targeted suites because it runs the complete test
matrix first.

`npm run verify:release-gates` executes release packaging gates without being a
replacement for CI's full test matrix.

Before publishing a Sirius package, run:

```bash
npm run verify:release-gates
npm run test:core
npm run test:adaptive
npm run test:council
npm run test:evolution
npm run test:integration
```

`npm run package:smoke` installs the packed package into a temporary project,
checks that the installed GUI client serves the React cockpit, and runs the
packaged Sirius mock config from `node_modules`.

`npm run pack:dry` warns about package-relevant untracked files and continues so
ordinary local draft docs do not break everyday verification. `npm run
pack:dry:strict` and `npm run release:verify` fail on those files and are the
release cleanliness gate.

Package entrypoint:

```bash
tedge
```

The `files` whitelist in `package.json` includes `dist`, docs, README,
CHANGELOG, LICENSE, release scripts, the tiny local LM demo source, and the
packaged Sirius mock config/command-agent demo.
