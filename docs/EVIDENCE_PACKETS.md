# Evidence Packets

Evidence packets are TomorrowEdge's coding-workflow-specific alternative to
generic tool-output compression.

An evidence packet contains:

- phase: plan, patch, test, repair, review, or judge
- summary
- claims
- supporting artifact refs
- risk signals
- verification status
- model-visible text

Reviewer and Judge roles can consume patch candidates plus evidence packets.
This keeps the full trace replayable while giving models compact, structured
evidence.

## Current Packets

- Patch evidence is created for every patch candidate.
- Review evidence is created from the reviewer report.
- Judge evidence is created from the judge decision.
- Test evidence is created from shell run stdout/stderr refs.

Packets are written as `evidence_packet` events and stored as artifacts.
