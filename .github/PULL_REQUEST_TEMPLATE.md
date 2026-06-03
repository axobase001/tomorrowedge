## Summary

- 

## Type

- [ ] Runtime / core
- [ ] Provider / routing
- [ ] Safety / permissions
- [ ] CLI / TUI
- [ ] Docs / community
- [ ] Tests / CI

## Verification

- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run smoke:cli`

## Safety Checklist

- [ ] No `.env`, `.tomorrowedge/`, session traces, API keys, or local artifacts.
- [ ] Full-access behavior remains visible in the event ledger.
- [ ] Shell commands remain guarded and avoid `shell: true`.
- [ ] Provider outputs and artifacts remain redacted before persistence/export.
