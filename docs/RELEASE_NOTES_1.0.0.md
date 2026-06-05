# TomorrowEdge 1.0.0 Release Notes

TomorrowEdge 1.0.0 is the first major release of the full-access coding
workflow cockpit.

This release does not turn TomorrowEdge into a generic personal-agent runtime.
It keeps the product position clear: a TUI-first cockpit for heterogeneous
coding agents, full-access execution, role routing, event-ledger visibility,
budget discipline, and human-supervised engineering delivery.

## Highlights

- README-aligned TUI cockpit layout:
  - top runtime header and access-mode badge
  - task/backend/provider/events status strip
  - Agents and Capability Route panels
  - Patch Candidate and Judge/Review panels
  - fixed Command/Talk input console for natural-language workflow control
- Natural-language TUI control:
  - type a task and press Enter to run a workflow
  - `/run`, `/ask`, `/to reviewer`, and `/mode full|partial|restricted`
  - `Ctrl+T` cycles the conversation target
  - `Ctrl+A`, `Ctrl+R`, and `Ctrl+U` handle patch/test/undo actions without
    stealing normal text input
- Full-access workflow visibility:
  - patch, shell, repair, review, judge, fallback, and provider events continue
    to enter the session ledger
  - artifact-aware trace/export features remain available
- Multi-model orchestration foundation:
  - role-routed Planner, Explorer, Coder, Reviewer, Judge, Runner, Repairer,
    and Summarizer paths
  - capability stitching for vision/spec/coding handoff
  - strong-agent budget scaffolding and routing diagnostics
- External-agent integration foundation:
  - MCP Agent Bridge
  - command runner skeletons
  - typed task/result envelopes for role-bound Codex/Claude Code style agents
- Product hardening remains in place:
  - `npm run verify`
  - zip-safe secret scanning
  - full/partial/restricted access modes
  - local tiny LM demo
  - local cockpit API and session inspection tools

## Upgrade

```bash
npm install
npm run verify
npm run dev -- tui
```

No API key is required for the offline fixture workflow.

## Positioning

Codex and Claude Code give agents full access. TomorrowEdge gives full access a
cockpit.

OpenRouter routes requests. TomorrowEdge routes roles and capabilities.
