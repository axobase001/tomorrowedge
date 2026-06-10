# Debate Protocol v2

Debate Protocol v2 turns reviewer/judge discussion into structured runtime
evidence.

Legacy `DebateRound` records are still supported. Version 2 builds a
`DebateSession` with:

- debate moves;
- accepted claims;
- rejected claims;
- unresolved blocking issues;
- evidence coverage score;
- final resolution.

The judge consumes this structure. If a candidate still has unresolved blocking
issues, the native judge requests revision unless policy allows bounded partial
completion and the task is not high risk.

Events:

- `debate_move`
- `debate_resolution`

The goal is not theatrical multi-agent chatter. The goal is evidence-based
argumentation that can block unsafe or under-evidenced patch selection.
