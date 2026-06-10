# Governed Skills And Tool Packs

TomorrowEdge skills are first-class, governed runtime objects. They are not
arbitrary scripts and they are not automatically executed when an agent proposes
one.

The first implementation is deliberately conservative:

- built-in human-seeded tool packs define stable operations;
- workflow recipes are represented as skill-like manifests;
- objective traces can propose inert candidate skills;
- candidate skills must pass schema, permission, contract, and sandbox checks;
- lifecycle transitions are explicit and auditable;
- tool/skill routing is separate from provider/model routing;
- compact objective traces record structured tool/skill usage for later scoring.

## Built-In Packs

`workspace_fs` covers path-safe workspace operations such as tree listing, file
reads, text search, patch proposal, approved patch application, undo, and
artifact writing.

`code_intelligence` covers code indexing, symbol/reference/test discovery,
script discovery, bounded lint/typecheck/test execution through shell policy,
and error localization.

`git_github` covers local git evidence and GitHub collaboration evidence such as
issue/PR/CI reads, review comment drafts, approved comment posting, and release
note drafts.

`web_research` covers bounded web search, page fetches, citation extraction,
recency checks, and source quality summaries. It is not available in restricted
mode because it needs network permission.

`document_knowledge` covers workspace Markdown/PDF reading, table extraction,
OCR evidence, and local knowledge indexing.

`data_database` covers CSV/JSON profiling, schema inspection, read-only SQL
query evidence, and migration risk checks. SQL query skills are high-risk and
must be explicitly allowed by the Objective Contract.

`api_integration` covers OpenAPI inspection, local HTTP smoke checks, auth
boundary review, mock coverage, and rate-limit risk evidence.

`workflow_recipes` mirrors the current built-in workflow recipes as governed
skills so recipes can seed future skill packs without replacing `tedge recipes`.

## Lifecycle

The lifecycle is:

```text
draft -> candidate -> validated -> stable -> deprecated
                         |          |-> blocked
                         |          |-> rolled_back
                         -> rejected
```

Promotion requires validation evidence. Rollback requires a previous version.
Candidate skills are disabled by default in runtime routing.

## CLI

```bash
tedge skills packs
tedge skills list
tedge skills inspect workspace.read_file
tedge skills propose --min-support 2 --write
tedge skills candidates
tedge skills validate path/to/skill.json --access-mode restricted
```

`propose` mines stored objective-action-feedback traces and writes inert
candidate records to `.tomorrowedge/candidate-skills.jsonl` only when requested.
It does not enable or execute candidates.

## Safety Boundary

Skill policy may change routing preference, but it cannot grant tools, weaken
access modes, bypass Objective Contracts, hide events, or execute unvalidated
candidate skills.
