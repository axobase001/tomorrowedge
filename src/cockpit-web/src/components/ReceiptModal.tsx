import type { CockpitTelemetry } from "../../../cockpit/contracts.js";

export function ReceiptModal({
  telemetry,
  goal,
  onDismiss
}: {
  telemetry: CockpitTelemetry;
  goal?: string;
  onDismiss: () => void;
}) {
  return (
    <div className="te-receipt-backdrop" role="presentation" onMouseDown={onDismiss}>
      <section className="te-receipt-card" role="dialog" aria-modal="true" aria-label="Cost receipt" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2>Cost receipt</h2>
            <p>{goal?.trim() || "TomorrowEdge workflow"}</p>
          </div>
          <button type="button" onClick={onDismiss} aria-label="Close cost receipt">x</button>
        </header>
        <div className="te-receipt-summary">
          <Metric label="actual" value={money(telemetry.currentCostUsd)} />
          <Metric label="budget" value={money(telemetry.budgetUsd)} />
          <Metric label="remaining" value={money(telemetry.budgetRemainingUsd)} />
          <Metric label="used" value={telemetry.budgetUsedPercent === undefined ? "-" : `${telemetry.budgetUsedPercent}%`} />
        </div>
        <div className="te-receipt-table">
          <div className="te-receipt-row te-receipt-head">
            <span>role</span>
            <span>model</span>
            <span>cost</span>
          </div>
          {telemetry.roleCosts?.length ? telemetry.roleCosts.map((item) => (
            <div className="te-receipt-row" key={`${item.role}:${item.model}`}>
              <span>{item.role}</span>
              <span>{item.model}</span>
              <span>{money(item.costUsd)} / {item.percent}%</span>
            </div>
          )) : (
            <div className="te-receipt-empty">No measured role costs for this session.</div>
          )}
        </div>
        <footer>
          <button type="button" onClick={onDismiss}>Close</button>
        </footer>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function money(value?: number) {
  return typeof value === "number" ? `$${value.toFixed(4)}` : "-";
}
