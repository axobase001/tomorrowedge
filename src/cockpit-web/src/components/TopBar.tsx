import type { CockpitViewModel } from "../../../cockpit/contracts.js";

export function TopBar({ viewModel, busy, onRun, onRefresh }: { viewModel: CockpitViewModel; busy: boolean; onRun: () => void; onRefresh: () => void }) {
  return (
    <header className="te-topbar" data-testid="topbar">
      <div className="te-brand">
        <span className="te-mark" aria-label="TomorrowEdge">
          <span className="te-mark-top" />
          <span className="te-mark-stem" />
          <span className="te-mark-trace" />
        </span>
        <div>
          <strong>TomorrowEdge GUI</strong>
          <span>{viewModel.workspace}</span>
        </div>
      </div>
      <div className="te-topbar-status">
        <span className="te-chip" title={viewModel.sessionMeta.message ?? viewModel.sessionMeta.connectionLabel}>
          {viewModel.sessionMeta.sourceLabel}
        </span>
        <span className={viewModel.sessionMeta.connectionState === "connected" ? "te-chip te-chip-green" : viewModel.sessionMeta.connectionState === "unavailable" || viewModel.sessionMeta.connectionState === "disconnected" ? "te-chip te-chip-red" : "te-chip"}>
          {viewModel.sessionMeta.connectionLabel}
        </span>
        {viewModel.sessionMeta.fixtureMode ? <span className="te-chip te-chip-blue">Fixture</span> : null}
        {viewModel.sessionMeta.stale ? <span className="te-chip">Snapshot</span> : null}
        <span className="te-chip te-chip-blue">{viewModel.accessMode === "full" ? "FULL AUTONOMY" : viewModel.accessMode}</span>
        <span className="te-chip">{viewModel.sessionId ?? "latest"}</span>
        <button type="button" disabled={busy} onClick={onRun} aria-label="Run workflow">Run</button>
        <button type="button" disabled={busy} onClick={onRefresh} aria-label="Refresh sessions">Refresh</button>
      </div>
    </header>
  );
}
