import { useState } from "react";
import type { CockpitTelemetry } from "../../../cockpit/contracts.js";
import type { Translator } from "../i18n.js";

// Estimated price per 1K tokens for common model tiers (matched by keyword)
const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "gpt-4o":        { input: 0.005, output: 0.015 },
  "gpt-4o-mini":   { input: 0.0015, output: 0.0045 },
  "deepseek":      { input: 0.00014, output: 0.00028 },
  "claude":        { input: 0.008, output: 0.024 },
  "gemini":        { input: 0.00125, output: 0.005 },
  "kimi":          { input: 0.0005, output: 0.002 },
  "mimo":          { input: 0.0004, output: 0.0016 },
};

function findModelPrice(model: string): { input: number; output: number; label: string } | undefined {
  const key = Object.keys(MODEL_PRICES).find((k) => model.toLowerCase().includes(k));
  if (!key) return undefined;
  return { ...MODEL_PRICES[key], label: key };
}

function cheaperAlternatives(currentCostPer1K: number, model: string): Array<{ name: string; input: number; output: number; label: string }> {
  const current = findModelPrice(model);
  if (!current) return [];
  const totalPer1K = current.input + current.output;
  return Object.entries(MODEL_PRICES)
    .filter(([k, v]) => {
      if (k === current.label) return false;
      return (v.input + v.output) < totalPer1K * 0.7;
    })
    .map(([k, v]) => ({ name: k, ...v, label: k }))
    .sort((a, b) => (a.input + a.output) - (b.input + b.output))
    .slice(0, 2);
}

export function TelemetryPanel({ telemetry, t, onOpenDetails }: { telemetry: CockpitTelemetry; t: Translator; onOpenDetails?: () => void }) {
  const [showWhatIf, setShowWhatIf] = useState(false);
  const routes = [
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
      {/* What-If Explorer */}
      {routes.length > 0 && (
        <>
          <button
            type="button"
            className="te-link-button"
            onClick={() => setShowWhatIf(!showWhatIf)}
            style={{ marginTop: 4, fontSize: 10 }}
          >
            {showWhatIf ? "▾" : "▸"} 如果换模型?
          </button>
          {showWhatIf && (
            <div style={{ margin: "0 12px 8px", padding: "6px 8px", border: "1px solid var(--te-border)", borderRadius: 5, background: "var(--te-alt)", fontSize: 11 }}>
              <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--te-deep-blue)" }}>换模型可以再省：</div>
              {routes.map((route) => {
                const [role, model] = route.split(": ") as [string, string];
                const alt = cheaperAlternatives(0, model);
                if (!alt.length) return null;
                return (
                  <div key={role} style={{ marginBottom: 4, padding: "3px 0", borderBottom: "1px solid rgba(215,228,234,0.3)" }}>
                    <div style={{ fontWeight: 500, marginBottom: 2 }}>{role}</div>
                    {alt.map((a) => {
                      const currentTotal = findModelPrice(model);
                      const currentCost = currentTotal ? (currentTotal.input + currentTotal.output) * 2 : 0.01;
                      const altCost = (a.input + a.output) * 2;
                      const saving = Math.max(0, currentCost - altCost);
                      return (
                        <div key={a.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0" }}>
                          <span style={{ color: "var(--te-muted)" }}>{a.name}</span>
                          <span style={{ font: "11px var(--te-mono)" }}>
                            {saving > 0 ? <>省 <strong style={{ color: "var(--te-success)" }}>${saving.toFixed(3)}</strong></> : "≈ 持平"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {(routes.some((r) => cheaperAlternatives(0, r.split(": ")[1]).length > 0)) && (
                <div style={{ textAlign: "center", marginTop: 4 }}>
                  <span className="te-chip te-chip-green" style={{ fontSize: 10, cursor: "pointer" }} onClick={() => alert("可配置到 config.yaml agents.{role}.provider")}>
                    应用建议
                  </span>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <button type="button" className="te-link-button" onClick={onOpenDetails} aria-label={t("telemetry.details")} data-testid="telemetry-details">
        {t("telemetry.details")}
      </button>
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
