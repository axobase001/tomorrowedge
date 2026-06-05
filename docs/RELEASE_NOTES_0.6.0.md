# TomorrowEdge 0.6.0 Release Notes

0.6.0 是 TomorrowEdge 的第一阶段架构升级版。它没有把项目改成通用个人
agent runtime，而是把 OpenSquilla 式的 artifact/context 分层思想吸收到
TomorrowEdge 自己的定位里：full-access coding workflow cockpit。

## Core Theme

TomorrowEdge preserves full artifacts for replay, but projects compact evidence
packets to models.

OpenSquilla routes turns. TomorrowEdge routes roles.

## Added

- Context Projection layer:
  - runtime artifact view
  - provider-visible compact view
  - stdout/stderr/diff/file/test-log/json reducers
- Evidence Packet layer:
  - patch evidence
  - test evidence
  - review evidence
  - judge evidence
- New trace events:
  - `routing_decision`
  - `budget_decision`
  - `artifact_projection`
  - `context_projection`
  - `evidence_packet`
  - `workflow_stop_reason`
  - `fallback_to_native`
  - `trace_completeness`
- Diagnostics CLI:
  - `tedge trace latest --diagnostics`
  - `tedge diagnostics latest`
- Typed external-agent handoff contracts:
  - task envelope
  - result envelope
  - patch/review/judge envelopes
- Role-routing policy scaffolding.
- Strong-agent budget scaffolding and `strong_agents` config.
- Product and architecture docs:
  - `docs/CONTEXT_PROJECTION.md`
  - `docs/EVIDENCE_PACKETS.md`
  - `docs/ARCHITECTURE_UPGRADE.md`
  - `docs/COMPARISONS.md`
  - `docs/PRODUCT_POSITIONING.md`
  - `docs/WHY_TOMORROWEDGE.md`
  - `README.product.md`

## Changed

- Reviewer and Judge roles can consume structured evidence packets alongside
  patch candidates, reviews, and judge decisions.
- External role invocation now passes typed task envelopes and can accept result
  envelopes through `payload`.
- Static cockpit fallback now keeps shell/repair/patch events visible even when
  diagnostic events increase trace density.
- README current-version section now describes Architecture Upgrade Phase 1.

## Verification

Release gate:

```bash
npm run verify
```

Result:

- 27 test files passed
- 141 tests passed
- TypeScript build passed
- secret scan passed
- audit check passed
- pack dry-run passed

Pack dry-run artifact:

```text
tomorrowedge-0.6.0.tgz
```
