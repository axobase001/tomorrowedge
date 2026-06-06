import type { CockpitViewModel } from "../../../cockpit/contracts.js";

export function TopBar({ viewModel }: { viewModel: CockpitViewModel }) {
  return (
    <header className="te-topbar">
      <div className="te-brand">
        <span className="te-mark">T</span>
        <div>
          <strong>TomorrowEdge / 明日边缘</strong>
          <span>{viewModel.workspace}</span>
        </div>
      </div>
      <div className="te-topbar-status">
        <span className="te-chip te-chip-blue">{viewModel.accessMode === "full" ? "FULL AUTONOMY" : viewModel.accessMode}</span>
        <span className="te-chip">{viewModel.sessionId ?? "latest"}</span>
        <button>Run</button>
        <button>settings</button>
      </div>
    </header>
  );
}
