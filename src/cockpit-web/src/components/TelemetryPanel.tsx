import type { CockpitTelemetry } from "../../../cockpit/contracts.js";

export function TelemetryPanel({ telemetry }: { telemetry: CockpitTelemetry }) {
  return (
    <aside className="te-panel te-telemetry">
      <header><h2>遥测</h2><span className="te-chip">fallback {telemetry.fallbackCount}</span></header>
      <Metric label="Cost" value={`${money(telemetry.currentCostUsd)} / ${money(telemetry.budgetUsd)}`} />
      <Metric label="Tokens" value={compact(telemetry.totalTokens)} />
      <Metric label="Cache" value={telemetry.cacheHitPercent ? `${telemetry.cacheHitPercent}%` : "-"} />
      <Metric label="Agents" value={`${telemetry.completed} done · ${telemetry.waiting} waiting`} />
      <Metric label="Latency" value={telemetry.latencyMs ? `${Math.round(telemetry.latencyMs / 1000)}s` : "-"} />
      <Metric label="Risk" value={telemetry.latestRiskLevel ?? "-"} />
      <a>details &gt;</a>
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
