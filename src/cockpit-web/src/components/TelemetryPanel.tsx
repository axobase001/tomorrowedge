import { useState } from "react";
import type { CockpitTelemetry } from "../../../cockpit/contracts.js";
import type { Translator } from "../i18n.js";
import { EmptyState } from "./StateNotice.js";
import { ReceiptModal } from "./ReceiptModal.js";

export function TelemetryPanel({ telemetry, t, goal, onOpenDetails }: { telemetry: CockpitTelemetry; t: Translator; goal?: string; onOpenDetails?: () => void }) {
  const [receiptOpen, setReceiptOpen] = useState(false);
  const routes = [
    telemetry.plannerModel && `planner: ${telemetry.plannerModel}`,
    telemetry.coderModel && `coder: ${telemetry.coderModel}`,
    telemetry.reviewerModel && `reviewer: ${telemetry.reviewerModel}`,
    telemetry.judgeModel && `judge: ${telemetry.judgeModel}`,
  ].filter(Boolean) as string[];
  const hasCostDetails = typeof telemetry.currentCostUsd === "number" || Boolean(telemetry.roleCosts?.length);
  const budgetTone = (telemetry.budgetUsedPercent ?? 0) >= 80 ? "danger" : (telemetry.budgetUsedPercent ?? 0) >= 55 ? "warn" : "ok";

  return (
    <aside className="te-panel te-telemetry" data-testid="telemetry-panel">
      <header><h2>{t("telemetry.title")}</h2><span className="te-chip">{t("telemetry.fallback", { count: telemetry.fallbackCount })}</span></header>
      {routes.length > 0 ? (
        <div data-testid="telemetry-routing">
          {routes.map((route) => (
            <div key={route} className="te-metric">
              <span>{route.split(": ")[0]}</span>
              <strong>{route.split(": ")[1]}</strong>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title={t("state.noRoutes")} detail={t("state.noRoutesDetail")} testId="telemetry-routes-empty-state" />
      )}
      <Metric label={t("telemetry.cost")} value={`${money(telemetry.currentCostUsd)} / ${money(telemetry.budgetUsd)}`} />
      {typeof telemetry.budgetUsedPercent === "number" ? (
        <div className={`te-budget-gauge te-budget-gauge-${budgetTone}`} data-testid="telemetry-budget-gauge">
          <div className="te-budget-gauge-header">
            <span>{telemetry.budgetUsedPercent}%</span>
            <strong>{telemetry.budgetRemainingUsd === undefined ? "-" : `${money(telemetry.budgetRemainingUsd)} left`}</strong>
          </div>
          <div className="te-budget-track" aria-hidden="true">
            <span className="te-budget-fill" style={{ width: `${telemetry.budgetUsedPercent}%` }} />
          </div>
        </div>
      ) : null}
      {typeof telemetry.liveRunningCostUsd === "number" && telemetry.liveRunningCostUsd > 0 ? (
        <Metric label="live cost" value={money(telemetry.liveRunningCostUsd)} />
      ) : null}
      <Metric label={t("telemetry.tokens")} value={compact(telemetry.totalTokens)} />
      <Metric label={t("telemetry.cache")} value={typeof telemetry.cacheHitPercent === "number" ? `${telemetry.cacheHitPercent}%` : "-"} />
      <Metric label={t("telemetry.agents")} value={t("telemetry.agentsValue", { done: telemetry.completed, waiting: telemetry.waiting })} />
      <Metric label="budget calls" value={`real ${telemetry.realBudgetDecisions} / sim ${telemetry.simulatedBudgetDecisions}`} />
      <Metric label={t("telemetry.latency")} value={telemetry.latencyMs ? `${Math.round(telemetry.latencyMs / 1000)}s` : "-"} />
      <Metric label={t("telemetry.risk")} value={telemetry.latestRiskLevel ?? "-"} />
      {telemetry.roleCosts?.length ? (
        <div className="te-role-costs" data-testid="telemetry-role-costs">
          {telemetry.roleCosts.slice(0, 4).map((item) => (
            <div key={`${item.role}:${item.model}`}>
              <span>{item.role}</span>
              <strong>{money(item.costUsd)}</strong>
            </div>
          ))}
        </div>
      ) : null}
      <div className="te-telemetry-actions">
        <button type="button" className="te-link-button" onClick={onOpenDetails} aria-label={t("telemetry.details")} data-testid="telemetry-details">
          {t("telemetry.details")}
        </button>
        {hasCostDetails ? (
          <button type="button" className="te-link-button" onClick={() => setReceiptOpen(true)} aria-label="Open cost receipt" data-testid="telemetry-receipt">
            receipt
          </button>
        ) : null}
      </div>
      {receiptOpen ? <ReceiptModal telemetry={telemetry} goal={goal} onDismiss={() => setReceiptOpen(false)} /> : null}
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="te-metric"><span>{label}</span><strong>{value}</strong></div>;
}

function money(value?: number) {
  return typeof value === "number" ? `$${value.toFixed(4)}` : "-";
}

function compact(value: number) {
  return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value);
}
