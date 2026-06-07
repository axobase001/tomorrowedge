import type { CockpitViewModel } from "../../../cockpit/contracts.js";

export function DetailDrawer({ viewModel, open, onClose }: { viewModel: CockpitViewModel; open: boolean; onClose: () => void }) {
  return (
    <aside className={`te-drawer ${open ? "open" : ""}`} aria-hidden={!open} data-testid="detail-drawer">
      <header>
        <h2>Details</h2>
        <button type="button" onClick={onClose} data-testid="close-drawer">Close</button>
      </header>
      <h3>Diff</h3>
      <pre>{viewModel.main.diff || "No diff in the current main view."}</pre>
      <h3>Routes</h3>
      <pre>{viewModel.routes.map((route) => `${route.role} -> ${route.provider}/${route.model}`).join("\n") || "-"}</pre>
      <h3>Artifacts</h3>
      <pre>{viewModel.artifacts.map((artifact) => artifact.ref).join("\n") || "-"}</pre>
      <h3>Raw events</h3>
      <pre>{JSON.stringify(viewModel.rawEvents.slice(-40), null, 2)}</pre>
    </aside>
  );
}
