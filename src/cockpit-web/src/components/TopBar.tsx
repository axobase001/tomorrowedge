import { useEffect, useState } from "react";
import type { CockpitViewModel } from "../../../cockpit/contracts.js";
import type { AccessMode } from "../../../config/schema.js";
import type { GuiLanguage, Translator } from "../i18n.js";
import { supportedLanguages, translateKnownValue } from "../i18n.js";

export function TopBar({
  viewModel,
  accessMode,
  busy,
  canRun,
  language,
  t,
  onLanguageChange,
  onOpenKeys,
  onRun,
  onCancelRun,
  onRefresh
}: {
  viewModel: CockpitViewModel;
  accessMode: AccessMode;
  busy: boolean;
  canRun: boolean;
  language: GuiLanguage;
  t: Translator;
  onLanguageChange: (language: GuiLanguage) => void;
  onOpenKeys: () => void;
  onRun: () => void;
  onCancelRun: () => void;
  onRefresh: () => void;
}) {
  const dailySavedUsd = useDailySavedUsd(viewModel.sessionId, viewModel.telemetry.budgetRemainingUsd);
  const runLabel = runActionLabel(accessMode, t);
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
          {translateKnownValue(t, viewModel.sessionMeta.sourceLabel)}
        </span>
        <span className={viewModel.sessionMeta.connectionState === "connected" ? "te-chip te-chip-green" : viewModel.sessionMeta.connectionState === "unavailable" || viewModel.sessionMeta.connectionState === "disconnected" ? "te-chip te-chip-red" : "te-chip"}>
          {translateKnownValue(t, viewModel.sessionMeta.connectionLabel)}
        </span>
        {dailySavedUsd !== undefined && dailySavedUsd > 0 ? (
          <span className="te-chip te-chip-green" title={t("topbar.savedBudgetTitle")}>
            {t("topbar.savedBudget", { amount: dailySavedUsd.toFixed(2) })}
          </span>
        ) : null}
        {viewModel.sessionMeta.fixtureMode ? <span className="te-chip te-chip-blue">{t("topbar.fixture")}</span> : null}
        {viewModel.sessionMeta.stale ? <span className="te-chip">{t("topbar.snapshot")}</span> : null}
        <label className="te-language-control">
          <span>{t("topbar.language")}</span>
          <select value={language} onChange={(event) => onLanguageChange(event.target.value as GuiLanguage)} data-testid="language-selector" aria-label={t("topbar.language")}>
            {supportedLanguages.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <span className="te-chip te-chip-blue">{viewModel.accessMode === "full" ? t("topbar.fullAutonomy") : viewModel.accessMode}</span>
        <span className="te-chip">{viewModel.sessionId ?? "latest"}</span>
        <button type="button" disabled={busy} onClick={onOpenKeys} aria-label={t("topbar.openKeys")} data-testid="topbar-keys">{t("topbar.keys")}</button>
        {busy ? (
          <button type="button" className="te-danger-button" onClick={onCancelRun} aria-label={t("topbar.cancelRun")} data-testid="topbar-cancel-run">{t("topbar.cancelRun")}</button>
        ) : (
          <button type="button" disabled={!canRun} onClick={onRun} aria-label={runLabel} data-testid="topbar-run">{runLabel}</button>
        )}
        <button type="button" disabled={busy} onClick={onRefresh} aria-label={t("topbar.refreshSessions")}>{t("topbar.refresh")}</button>
      </div>
    </header>
  );
}

function runActionLabel(accessMode: AccessMode, t: Translator): string {
  if (accessMode === "full") return t("topbar.runFull");
  if (accessMode === "restricted") return t("topbar.runRestricted");
  return t("topbar.runSupervised");
}

function useDailySavedUsd(sessionId: string | undefined, savedUsd: number | undefined): number | undefined {
  const [total, setTotal] = useState<number>();

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    const today = new Date().toISOString().slice(0, 10);
    const key = `tedge_budget_remaining_${today}`;
    const ledger = readLedger(key);
    if (sessionId && savedUsd !== undefined && savedUsd > 0) {
      ledger[sessionId] = Math.max(ledger[sessionId] ?? 0, savedUsd);
      localStorage.setItem(key, JSON.stringify(ledger));
    }
    setTotal(Object.values(ledger).reduce((sum, value) => sum + value, 0));
  }, [sessionId, savedUsd]);

  return total;
}

function readLedger(key: string): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
    const entries: Array<[string, number]> = [];
    for (const [entryKey, value] of Object.entries(parsed)) {
      const numericValue = typeof value === "number" && Number.isFinite(value) ? value : 0;
      if (numericValue > 0) entries.push([entryKey, numericValue]);
    }
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}
