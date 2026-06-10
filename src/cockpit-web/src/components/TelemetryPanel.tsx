import { useState } from "react";
import type { CockpitTelemetry } from "../../../cockpit/contracts.js";
import type { Translator } from "../i18n.js";
import { ReceiptModal } from "./ReceiptModal.js";

const SAVED_COLOR = "#2f9d68";
const DANGER_COLOR = "#c94a4a";
const WARN_COLOR = "#e0b15a";
const GOLD_COLOR = "#d4a843";

export function TelemetryPanel({ telemetry, t, goal, onOpenDetails }: { telemetry: CockpitTelemetry; t: Translator; goal?: string; onOpenDetails?: () => void }) {
  const [showReceipt, setShowReceipt] = useState(false);
  const routes = [
    telemetry.coderModel && `coder: ${telemetry.coderModel}`,
    telemetry.reviewerModel && `reviewer: ${telemetry.reviewerModel}`,
    telemetry.judgeModel && `judge: ${telemetry.judgeModel}`,
  ].filter(Boolean) as string[];

  const savings = telemetry.savedUsd ?? 0;
  const savedPct = telemetry.savingsPercent;
  const usedPct = telemetry.budgetUsedPercent ?? 0;
  const showGolden = savedPct !== undefined && savedPct > 50;
  const badgeColor = showGolden ? GOLD_COLOR : SAVED_COLOR;
  const progressColor = usedPct > 75 ? DANGER_COLOR : usedPct > 50 ? WARN_COLOR : SAVED_COLOR;
  const chipClass = showGolden ? "te-chip-golden" : usedPct > 75 ? "te-chip-red" : "te-chip-green";

  return (
    <aside className="te-panel te-telemetry" data-testid="telemetry-panel">
      <header><h2>{t("telemetry.title")}</h2><span className="te-chip">{t("telemetry.fallback", { count: telemetry.fallbackCount })}</span></header>

      {/* Savings badge */}
      {savings > 0 && (
        <div className="te-savings-badge" style={{ margin: "10px 12px", padding: "8px 12px", borderRadius: 6, background: "rgba(47,157,104,0.1)", border: `1px solid ${badgeColor}40`, textAlign: "center" }}>
          <div style={{ font: "700 20px/1 'Cascadia Mono', monospace", color: badgeColor, letterSpacing: "-0.02em" }}>
            ${savings.toFixed(4)}
            <span style={{ fontSize: 16, marginLeft: 4 }}>{showGolden ? "🏆" : "⚡"}</span>
          </div>
          <div style={{ font: "11px 'Cascadia Mono', monospace", color: "#6b7a88", marginTop: 2 }}>
            vs <strong>{telemetry.baselineModelLabel || "baseline"}</strong> · 省了
          </div>
        </div>
      )}

      {/* Budget progress bar */}
      {telemetry.currentCostUsd !== undefined && telemetry.budgetUsd !== undefined && (
        <div style={{ margin: "0 12px 10px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
            <span style={{ font: "600 13px 'Cascadia Mono', monospace" }}>${telemetry.currentCostUsd.toFixed(4)}</span>
            <span style={{ font: "12px 'Cascadia Mono', monospace", color: "#6b7a88" }}>/ ${telemetry.budgetUsd.toFixed(2)}</span>
          </div>
          <div style={{ position: "relative", height: 6, borderRadius: 3, background: "#eef5f8", overflow: "visible" }}>
            <div style={{ height: "100%", borderRadius: 3, background: `linear-gradient(90deg, ${SAVED_COLOR}, ${WARN_COLOR}, ${DANGER_COLOR})`, width: `${Math.min(usedPct, 100)}%`, transition: "width 0.6s cubic-bezier(0.22,1,0.36,1)" }} />
          </div>
        </div>
      )}

      {/* Savings percent chip */}
      {savedPct !== undefined && (
        <div className="te-metric with-badge" style={{ margin: "0 12px", padding: "8px 0", borderBottom: "1px solid rgba(215,228,234,0.6)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#6b7a88", fontSize: 12 }}>{t("telemetry.cost")}</span>
          <span className={`te-chip ${chipClass}`} style={{ fontSize: 11 }}>
            {showGolden ? "🏆 " : ""}省 {savedPct}%
          </span>
        </div>
      )}

      {/* Routes */}
      {routes.length > 0 && (
        <div data-testid="telemetry-routing" style={{ margin: "0 12px" }}>
          {routes.map((route) => (
            <div key={route} className="te-metric">
              <span>{route.split(": ")[0]}</span>
              <strong>{route.split(": ")[1]}</strong>
            </div>
          ))}
        </div>
      )}

      <Metric label={t("telemetry.tokens")} value={compact(telemetry.totalTokens)} />
      <Metric label={t("telemetry.latency")} value={telemetry.latencyMs ? `${Math.round(telemetry.latencyMs / 1000)}s` : "-"} />
      <Metric label={t("telemetry.agents")} value={t("telemetry.agentsValue", { done: telemetry.completed, waiting: telemetry.waiting })} />

      {/* Cross-session cumulative savings */}
      {telemetry.cumulativeSavedUsd !== undefined && telemetry.cumulativeSavedUsd > 0 && (
        <div className="te-metric" style={{ margin: "0 12px", padding: "8px 0", borderBottom: "1px solid rgba(215,228,234,0.6)" }}>
          <span style={{ color: "#6b7a88", fontSize: 12 }}>累计省</span>
          <strong style={{ font: "13px 'Cascadia Mono', monospace", color: SAVED_COLOR }}>
            ${telemetry.cumulativeSavedUsd.toFixed(4)}
            {telemetry.nextMilestoneUsd !== undefined && ` / $${telemetry.nextMilestoneUsd.toFixed(2)}`}
          </strong>
        </div>
      )}

      {/* Per-role costs */}
      {telemetry.roleCosts && telemetry.roleCosts.length > 0 && (
        <div style={{ margin: "0 12px 8px", paddingTop: 6, borderTop: "1px solid rgba(215,228,234,0.5)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#6b7a88", marginBottom: 4 }}>
            <span>角色费用</span><span>预估</span>
          </div>
          {telemetry.roleCosts.map((r) => (
            <div key={r.role} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", fontSize: 12, borderBottom: "1px solid rgba(215,228,234,0.3)" }}>
              <span style={{ flex: 1, fontWeight: 500 }}>{r.role}</span>
              <span style={{ font: "11px 'Cascadia Mono', monospace", color: "#6b7a88" }}>{r.model}</span>
              <span style={{ font: "11px 'Cascadia Mono', monospace" }}>${r.costUsd.toFixed(4)}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, margin: "6px 12px 0" }}>
        <button type="button" className="te-link-button" onClick={onOpenDetails} aria-label={t("telemetry.details")} data-testid="telemetry-details" style={{ flex: 1 }}>
          {t("telemetry.details")}
        </button>
        {telemetry.savedUsd !== undefined && telemetry.savedUsd > 0 && (
          <button type="button" className="te-link-button" onClick={() => setShowReceipt(true)} style={{ flex: 1, textAlign: "center" }}>
            🧾 小票
          </button>
        )}
      </div>
      {showReceipt && (
        <ReceiptModal telemetry={telemetry} goal={goal} t={t} onDismiss={() => setShowReceipt(false)} />
      )}
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="te-metric"><span>{label}</span><strong>{value}</strong></div>;
}

function compact(value: number) {
  return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value);
}
