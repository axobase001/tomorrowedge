# Objective Contracts

Objective Contracts are the v1.3 boundary between a user request and the
workflow that TomorrowEdge is allowed to execute.

The contract is generated before planning. It turns a natural-language request
into a typed local objective:

- scenario type and workflow kind
- success and failure criteria
- required evidence
- allowed phases, roles, and tools
- forbidden actions
- budget and repair bounds
- stop conditions for success, partial completion, failure, and unsafe exits

The important rule is:

> The planner may enrich an Objective Contract, but it must not relax it.

That is why the native planner is now overlaid with contract constraints after
model or native planning. If the user asks for a read-only inspection, later
planning cannot silently turn it into a patch workflow. If the user asks for a
patch, the contract requires review, judge, and verification evidence before
the run can claim completion.

## Lifecycle

```text
User request
  -> workflow intent
  -> scenario profile
  -> Objective Contract
  -> contract verification / repair
  -> contract-derived plan
  -> role graph / routing / execution
  -> objective-action-feedback trace
```

## CLI

```bash
tedge contract inspect latest
tedge contract inspect latest --json
```

The inspector reads the saved session and shows the contract, verification
status, evidence requirements, allowed tools, forbidden actions, and stop
conditions.

