import type { CockpitTelemetry } from "../../../cockpit/contracts.js";
import type { Translator } from "../i18n.js";

export function ReceiptModal({
  telemetry,
  goal,
  t,
  onDismiss
}: {
  telemetry: CockpitTelemetry;
  goal?: string;
  t: Translator;
  onDismiss: () => void;
}) {
  return (
    <div className="te-receipt-backdrop" role="presentation" onMouseDown={onDismiss}>
      <section className="te-receipt-card" role="dialog" aria-modal="true" aria-label={t("receipt.title")} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2>{t("receipt.title")}</h2>
            <p>{goal?.trim() || t("receipt.defaultGoal")}</p>
          </div>
          <button type="button" onClick={onDismiss} aria-label={t("receipt.closeLabel")}>x</button>
        </header>
        <div className="te-receipt-summary">
          <Metric label={t("receipt.actual")} value={money(telemetry.currentCostUsd)} />
          <Metric label={t("receipt.budget")} value={money(telemetry.budgetUsd)} />
          <Metric label={t("receipt.remaining")} value={money(telemetry.budgetRemainingUsd)} />
          <Metric label={t("receipt.used")} value={telemetry.budgetUsedPercent === undefined ? "-" : `${telemetry.budgetUsedPercent}%`} />
        </div>
        <div className="te-receipt-table">
          <div className="te-receipt-row te-receipt-head">
            <span>{t("receipt.role")}</span>
            <span>{t("receipt.model")}</span>
            <span>{t("receipt.cost")}</span>
          </div>
          {telemetry.roleCosts?.length ? telemetry.roleCosts.map((item) => (
            <div className="te-receipt-row" key={`${item.role}:${item.model}`}>
              <span>{item.role}</span>
              <span>{item.model}</span>
              <span>{money(item.costUsd)} / {item.percent}%</span>
            </div>
          )) : (
            <div className="te-receipt-empty">{t("receipt.empty")}</div>
          )}
        </div>
        <footer>
          <button type="button" onClick={onDismiss}>{t("receipt.close")}</button>
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
