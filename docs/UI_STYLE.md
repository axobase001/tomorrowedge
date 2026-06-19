# UI Style

TomorrowEdge has two first-class cockpit surfaces:

- Browser GUI: Four-Zone Quiet Cockpit for local workflow supervision.
- Ink TUI: keyboard-driven terminal cockpit for dense terminal use.

Authoritative browser GUI design contract: `docs/GUI_DESIGN_SYSTEM.md`.

Default browser GUI language: English (`en`) with a Chinese (`zh`) selector in
the React cockpit. The embedded fallback cockpit is English-only and declares
`lang="en"` until it gains the React i18n runtime.

## GUI v1.1 Direction

The browser GUI should feel like a quiet local coding-agent cockpit, not an
admin dashboard.

Principles:

- Codex-like quiet tool feel
- blue-white cold palette
- Japanese wabi-sabi inspired spacing
- sparse but functional layout
- summary-first information design
- center workflow remains the visual focus
- details appear through drawer / expand / hover only when needed
- no chat bubble interface
- no SaaS dashboard or enterprise admin feel

Default GUI palette:

```text
background:    #F6FAFC
surface:       #FFFFFF
alt-surface:   #EEF5F8
border:        #D7E4EA
text:          #17212B
muted:         #6B7A88
primary-blue:  #6FAFD2
deep-blue:     #2F6F92
success:       #2F9D68
warning:       #B7791F
danger:        #C94A4A
```

## Layout

```text
Top Bar:     44-52px
Left Panel:  19-22% task queue
Center:      54-58% workflow main area
Right Panel: 20-24% telemetry summary
Composer:    72-86px command composer
```

## Image2 References

The GUI v1.1 visual decisions come from the image2-first prompt pack and
selected references:

- `docs/ui/image2-components/outputs/04-telemetry-collapsed-v11.png`
- `docs/ui/image2-components/outputs/05-workflow-spine-light-v11.png`
- `docs/ui/image2-components/outputs/06-task-list-reduced-v11.png`
- `docs/ui/image2-components/outputs/07-command-composer-quiet-v11.png`
- `docs/ui/image2-components/outputs/08-topbar-simplified-v11.png`
- `docs/ui/image2-components/outputs/09-approval-main-workspace-v11.png`
- `docs/ui/image2-components/outputs/10-fullscreen-v11-variants.png`

See:

- `docs/ui/GUI_REFACTOR_V1_1_SCOPE.md`
- `docs/ui/image2-components/review/component_review.md`
- `docs/ui/gui-v1.1/component_mapping.md`
- `docs/ui/gui-v1.1/implementation_deviation.md`

## TUI Direction

The TUI remains terminal-first: compact Chinese panes, explicit routing state,
diff/shell/evidence views, and keyboard-driven approval controls. It can stay
darker and denser than the browser GUI, but should preserve the same workflow
semantics through shared cockpit view models and selectors.

## Avoid

- purple cyberpunk
- neon or decorative gradients
- glassmorphism
- SaaS dashboard card walls
- cloud-console resource tables as the default view
- CRM/ticket-system task cards
- ChatGPT-style chat history as the main interface
- marketing landing-page composition
