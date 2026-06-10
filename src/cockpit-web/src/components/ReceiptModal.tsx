import type { CockpitTelemetry } from "../../../cockpit/contracts.js";
import type { Translator } from "../i18n.js";

export function ReceiptModal({
  telemetry,
  goal,
  t,
  onDismiss,
}: {
  telemetry: CockpitTelemetry;
  goal?: string;
  t: Translator;
  onDismiss: () => void;
}) {
  const saved = telemetry.savedUsd ?? 0;
  const actual = telemetry.currentCostUsd ?? 0;
  const baseline = telemetry.baselineCostUsd ?? 0;
  const pct = telemetry.savingsPercent ?? 0;
  const showGolden = pct > 50;
  const co2 = Math.round((saved / 10) * 100) / 100; // rough: $10 ≈ 1kg CO2
  const discountPct = baseline > 0 ? Math.round((saved / baseline) * 100) : 0;

  return (
    <div
      onClick={onDismiss}
      style={{
      position: "fixed", inset: 0, zIndex: 80,
      display: "grid", placeItems: "center",
      background: "rgba(11,18,24,0.42)",
      animation: "te-fade-in 120ms ease",
      padding: 20,
    }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
        width: "min(400px, calc(100vw - 32px))",
        border: "1px solid var(--te-border)",
        borderRadius: 7,
        background: "var(--te-surface)",
        boxShadow: "0 24px 70px rgba(21,34,44,0.24)",
        padding: 20,
        animation: "te-slide-in 160ms ease",
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
              📋 费用明细
            </h2>
            <p style={{ margin: "4px 0 0", color: "var(--te-muted)", fontSize: 12, fontFamily: "var(--te-mono)" }}>
              {goal?.slice(0, 50) || "task"}
            </p>
          </div>
          <button
            onClick={onDismiss}
            style={{ border: "1px solid var(--te-border)", borderRadius: 5, background: "transparent", cursor: "pointer", minHeight: 30, padding: "0 10px", color: "var(--te-muted)" }}
            aria-label={t("receipt.dismiss")}
          >
            ✕
          </button>
        </div>

        {/* Cost breakdown table */}
        <div style={{ marginBottom: 14, fontFamily: "var(--te-mono)", fontSize: 12 }}>
          {telemetry.roleCosts?.map((r) => (
            <div key={r.role} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(215,228,234,0.3)" }}>
              <span style={{ color: "var(--te-muted)" }}>{r.role}</span>
              <span style={{ color: "var(--te-muted)" }}>{r.model.split("/").pop()}</span>
              <span>${r.costUsd.toFixed(4)}</span>
            </div>
          ))}
          {(!telemetry.roleCosts || telemetry.roleCosts.length === 0) && (
            <div style={{ padding: "8px 0", color: "var(--te-muted)", textAlign: "center" }}>无费用数据</div>
          )}
        </div>

        {/* Baseline comparison */}
        <div style={{ borderTop: "2px solid var(--te-border)", paddingTop: 10, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "var(--te-mono)", marginBottom: 4 }}>
            <span style={{ color: "var(--te-muted)" }}>实际花费</span>
            <span>${actual.toFixed(4)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "var(--te-mono)", marginBottom: 4 }}>
            <span style={{ color: "var(--te-muted)" }}>vs {telemetry.baselineModelLabel || "best model"}</span>
            <span style={{ color: "var(--te-danger)" }}>${baseline.toFixed(4)}</span>
          </div>
        </div>

        {/* Savings highlight */}
        {saved > 0 && (
          <div style={{
            padding: "10px 12px",
            borderRadius: 6,
            background: showGolden ? "rgba(212,168,67,0.1)" : "rgba(47,157,104,0.1)",
            border: `1px solid ${showGolden ? "#d4a843" : "#2f9d68"}40`,
            textAlign: "center",
            marginBottom: 12,
          }}>
            <div style={{ font: "700 22px/1 var(--te-mono)", color: showGolden ? "#d4a843" : "#2f9d68", letterSpacing: "-0.02em" }}>
              💰 省了 ${saved.toFixed(4)} {showGolden ? "🏆" : "🎉"}
            </div>
            <div style={{ font: "12px var(--te-mono)", color: "var(--te-muted)", marginTop: 4 }}>
              相当于 {discountPct}% 的折扣！
            </div>
          </div>
        )}

        {/* Eco equivalent */}
        {co2 > 0 && (
          <div style={{ fontSize: 11, color: "var(--te-muted)", fontFamily: "var(--te-mono)", textAlign: "center", marginBottom: 12 }}>
            🌳 相当于减少了 {co2.toFixed(2)}kg CO₂
          </div>
        )}

        {/* Dismiss button */}
        <button
          onClick={onDismiss}
          style={{
            width: "100%", minHeight: 34,
            border: "1px solid var(--te-deep-blue)",
            borderRadius: 5,
            background: "transparent",
            color: "var(--te-deep-blue)",
            cursor: "pointer",
            font: "12px var(--te-sans)",
          }}
        >
          {t("receipt.dismiss")}
        </button>
      </div>
    </div>
  );
}
