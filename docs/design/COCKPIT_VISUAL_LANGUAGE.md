# Cockpit Visual Language Foundations

Status: Draft / Proposal
Owner: GUI / Cockpit
Tracking issue: [#531](https://github.com/axobase001/tomorrowedge/issues/531)
Scope: `src/cockpit-web/src/`

## 1. Why this document exists

TomorrowEdge has matured into a serious local orchestration and governance
runtime for heterogeneous Coding Agents, but its Cockpit GUI still presents
itself as an internal debug console. Reading `src/cockpit-web/src/App.tsx`
and `src/cockpit-web/src/theme/tokens.css`, three facts stand out:

1. All color, spacing, radius, shadow and typography decisions live in a
   single 1.5k-line `tokens.css` with **flat, undifferentiated raw variables**
   (`--te-blue`, `--te-deep-blue`, `--te-success`, ...). There is no semantic
   layer that names *what a token is for*.
2. The three columns (`te-task-panel` / `te-workflow` / `te-telemetry`) share
   the same visual weight, so the user cannot tell which area is the primary
   stage and which are supporting rails.
3. Core narratives the product is built around — Convergence Spine, Council
   ownership, EvidenceGate / BudgetGate, AccessMode = full — are rendered as
   plain text inside hairline-bordered strips, with no graphical language to
   carry meaning.

The goal of this document is **not** to replace the cockpit in one PR.
It is to land a **token-level foundation** that subsequent PRs can build on,
while leaving every existing component, class name and screenshot untouched.

## 2. Design principles

1. **Governance first, telemetry second, chrome last.**
   Visual weight follows the governance story: Convergence Stage and
   Approval / Danger Surface always win against secondary metrics.
2. **Semantic tokens over raw tokens.**
   Components consume `--te-color-surface-1`, not `#ffffff`; surfaces and
   states are named, not numbered.
3. **Elevation as a first-class concept.**
   Surfaces live on a discrete elevation ladder (page → panel → floating →
   drawer → modal → danger). Each elevation has its own surface, border and
   shadow tokens.
4. **Density is a setting, not a fixed pixel value.**
   `--te-space-*` is derived from a 4px grid; future density modes (comfort
   vs. compact) become a matter of swapping a single set of tokens.
5. **Reduced motion is the default contract.**
   Animations are short (≤ 200ms), purposeful, and gated by
   `prefers-reduced-motion`.

## 3. Token layering

The current `tokens.css` mixes three concerns in one file. The proposal
introduces a clear layering, while keeping the existing file as the
**base** layer:

```
theme/
  tokens.css                  # existing — base palette + component CSS (unchanged)
  tokens.polish.css           # NEW (polish pass 1) — additive @layer te-polish refinement
  tokens.semantic.css         # NEW — semantic mapping built on top of base
  (future) tokens.dark.css    # dark-mode overrides recalibrated for contrast
  (future) tokens.density.css # density variants (comfortable / compact)
  (future) primitives/        # framework-free visual primitives
```

`tokens.polish.css` is wired into `App.tsx` and refines hover / focus / shadow
/ scrollbar / ligature appearance without changing any element's box, layout,
or DOM contract. See the file header for the full constraint list.

`tokens.semantic.css` is **not yet imported**, because importing it would
change runtime CSS and risk breaking the Cockpit Playwright smoke. It is
shipped as a reviewable contract first; a follow-up PR will wire it in once
it has been reviewed.

### 3.1 Semantic surfaces

| Token                          | Maps to (base)         | Intent                                  |
|--------------------------------|------------------------|-----------------------------------------|
| `--te-color-surface-page`      | `--te-bg`              | Outer shell background                  |
| `--te-color-surface-1`         | `--te-surface`         | Panel body                              |
| `--te-color-surface-2`         | `--te-alt`             | Panel alt / metric row                  |
| `--te-color-surface-3`         | `--te-soft`            | Inset / spine background                |
| `--te-color-surface-floating`  | `--te-surface`         | Drawer / popover                        |
| `--te-color-surface-modal`     | `--te-surface`         | Modal (Setup, KeyRoleManager, Receipt)  |
| `--te-color-surface-danger`    | `color-mix(...)`       | Full-access composer / approval        |

### 3.2 Semantic text & borders

| Token                       | Intent                                       |
|-----------------------------|----------------------------------------------|
| `--te-color-text-primary`   | Default body                                  |
| `--te-color-text-secondary` | Muted captions, metric labels                 |
| `--te-color-text-inverse`   | On accent / on danger                         |
| `--te-color-border-subtle`  | Internal dividers                             |
| `--te-color-border-default` | Panel borders                                 |
| `--te-color-border-strong`  | Focused panels, selected items                |

### 3.3 Semantic states & roles

| Token                         | Intent                                       |
|-------------------------------|----------------------------------------------|
| `--te-color-state-info`       | Neutral progress, advisory                   |
| `--te-color-state-success`    | Acceptance pass, converged                   |
| `--te-color-state-warning`    | Budget warn, no-progress                     |
| `--te-color-state-danger`     | Blocking-check failure, full-access risk     |
| `--te-color-role-chief`       | Chief Agent emphasis                         |
| `--te-color-role-member`      | Council member nodes                         |
| `--te-color-role-reviewer`    | Reviewer / judge surface                     |

### 3.4 Elevation ladder

| Token                  | Use                                           |
|------------------------|-----------------------------------------------|
| `--te-elevation-0`     | Flat (rails inside a panel)                   |
| `--te-elevation-1`     | Panels on the page                            |
| `--te-elevation-2`     | Floating popovers, segmented composer         |
| `--te-elevation-3`     | Drawer / bottom trace sheet                   |
| `--te-elevation-4`     | Modal (Setup / KeyRoleManager / Receipt)      |
| `--te-elevation-danger`| Full-access composer & approval surfaces      |

### 3.5 Typography & spacing

A five-step type scale (`display / title / body / mono / caption`) and an
4px spacing scale (`--te-space-1` .. `--te-space-8`) are defined so that
existing hard-coded `10/12/14/16px` paddings can be migrated gradually.

## 4. Implementation plan

This is the *first* of a series of PRs. Each subsequent PR is small,
reviewable on its own, and only depends on the previous one:

1. **(this PR)** Land the design language doc + semantic token contract
   without modifying any runtime CSS.
2. Wire `tokens.semantic.css` behind `@layer` so it can coexist with the
   existing file. No component changes.
3. Migrate `WorkflowPanel` to consume semantic tokens; introduce a
   visualised Convergence Spine primitive (`Spine`).
4. Migrate `TelemetryPanel` into a `GovernanceSidebar` (budget radial gauge,
   role allocation, convergence health).
5. Migrate `TaskListPanel` into a `MissionRail` with mini-spine and owner
   role colouring.
6. Re-skin `BottomTraceSheet` (filtering, severity colours, timeline) — pairs
   with #467.
7. Add responsive breakpoints — pairs with #466.
8. Land the `DangerSurface` system for AccessMode = full.

Each step keeps the existing class names and behaviour; the visual layer is
swapped out beneath them.

## 5. Non-goals

- This PR does **not** swap the runtime visual layer.
- This PR does **not** add a new framework, CSS-in-JS, Tailwind, or
  preprocessor.
- This PR does **not** modify any existing file under `src/`.
- This PR does **not** touch dark-mode contrast calibration; that lives in
  a future `tokens.dark.css`.

## 6. Verification

This change adds documentation and an unused stylesheet only. The existing
test, typecheck, build, web-build, cockpit smoke, secret scan, audit and
pack-dry pipelines are unaffected. All CI steps in `.github/workflows/ci.yml`
continue to run unchanged.
