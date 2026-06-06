# GUI v1.1 Implementation Deviations

- Image2 boards sometimes use decorative icons. The implementation uses text
  labels and native buttons where that improves deterministic rendering and
  accessibility.
- The local cockpit still serves a dependency-light inline GUI so `tedge serve`
  works after `npm install` without a separate Vite build. The React/Vite source
  is explicitly a future scaffold, not a second source of truth. Both surfaces
  use `src/cockpit/contracts.ts` and `src/cockpit/viewModel.ts` as the shared
  component/view-model contract.
- v1.1 review hardening connects browser approval buttons to real Node-side
  workflow actions. The browser still sends only an intent; Node applies or
  rejects patches/shell commands, saves the session, and pushes the updated
  ViewModel back to the cockpit.
- Full diff content remains available in the shared view model and drawer, but
  the default approval workspace intentionally shows only a summary to satisfy
  v1.1 summary-first requirements.
- Hover-only metadata from the reference is represented as progressively
  disclosed drawer content in the served fallback UI.
