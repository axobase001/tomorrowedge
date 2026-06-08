import type { CockpitTelemetry } from "../../../cockpit/contracts.js";
import type { Translator } from "../i18n.js";

export function TelemetryPanel({ telemetry, t }: { telemetry: CockpitTelemetry; t: Translator }) {
  const routes = [
    telemetry.plannerModel && `planner: ${telemetry.plannerModel}`,
    telemetry.coderModel && `coder: ${telemetry.coderModel}`,
    telemetry.reviewerModel && `reviewer: ${telemetry.reviewerModel}`,
    telemetry.judgeModel && `judge: ${telemetry.judgeModel}`,
  ].filter(Boolean) as string[];

  return (
    <aside className="te-panel te-telemetry" data-testid="telemetry-panel">
      <header><h2>{t("telemetry.title")}</h2><span className="te-chip">{t("telemetry.fallback", { count: telemetry.fallbackCount })}</span></header>
      {routes.length > 0 && (
        <div data-testid="telemetry-routing">
          {routes.map((route) => (
            <div key={route} className="te-metric">
              <span>{route.split(": ")[0]}</span>
              <strong>{route.split(": ")[1]}</strong>
            </div>
          ))}
        </div>
      )}
      <Metric label={t("telemetry.cost")} value={`${money(telemetry.currentCostUsd)} / ${money(telemetry.budgetUsd)}`} />
      <Metric label={t("telemetry.tokens")} value={compact(telemetry.totalTokens)} />
      <Metric label={t("telemetry.cache")} value={typeof telemetry.cacheHitPercent === "number" ? `${telemetry.cacheHitPercent}%` : "-"} />
      <Metric label={t("telemetry.agents")} value={t("telemetry.agentsValue", { done: telemetry.completed, waiting: telemetry.waiting })} />
      <Metric label={t("telemetry.latency")} value={telemetry.latencyMs ? `${Math.round(telemetry.latencyMs / 1000)}s` : "-"} />
      <Metric label={t("telemetry.risk")} value={telemetry.latestRiskLevel ?? "-"} />
      <a>{t("telemetry.details")}</a>
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
