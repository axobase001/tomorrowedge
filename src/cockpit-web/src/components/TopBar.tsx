import type { CockpitViewModel } from "../../../cockpit/contracts.js";
import type { GuiLanguage, Translator } from "../i18n.js";
import { supportedLanguages, translateKnownValue } from "../i18n.js";

export function TopBar({
  viewModel,
  busy,
  canRun,
  language,
  t,
  onLanguageChange,
  onOpenKeys,
  onRun,
  onRefresh
}: {
  viewModel: CockpitViewModel;
  busy: boolean;
  canRun: boolean;
  language: GuiLanguage;
  t: Translator;
  onLanguageChange: (language: GuiLanguage) => void;
  onOpenKeys: () => void;
  onRun: () => void;
  onRefresh: () => void;
}) {
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
        {viewModel.sessionMeta.fixtureMode ? <span className="te-chip te-chip-blue">{t("topbar.fixture")}</span> : null}
        {viewModel.sessionMeta.stale ? <span className="te-chip">{t("topbar.snapshot")}</span> : null}
        {viewModel.telemetry.savedUsd !== undefined && viewModel.telemetry.savedUsd > 0 && (
          <span className="te-chip te-chip-green" title="累计节省 (跨 session)">
            💰 省 {viewModel.telemetry.savingsPercent ?? 0}%
            {viewModel.telemetry.cumulativeSavedUsd !== undefined && viewModel.telemetry.cumulativeSavedUsd >= viewModel.telemetry.savedUsd
              ? ` · 累计 $${viewModel.telemetry.cumulativeSavedUsd.toFixed(2)}`
              : ""}
          </span>
        )}
        <label className="te-language-control">
          <span>{t("topbar.language")}</span>
          <select value={language} onChange={(event) => onLanguageChange(event.target.value as GuiLanguage)} data-testid="language-selector" aria-label={t("topbar.language")}>
            {supportedLanguages.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <span className="te-chip te-chip-blue">{viewModel.accessMode === "full" ? t("topbar.fullAutonomy") : viewModel.accessMode}</span>
        <span className="te-chip">{viewModel.sessionId ?? "latest"}</span>
        <button type="button" disabled={busy} onClick={onOpenKeys} aria-label={t("topbar.openKeys")} data-testid="topbar-keys">{t("topbar.keys")}</button>
        <button type="button" disabled={!canRun} onClick={onRun} aria-label={t("topbar.runWorkflow")}>{t("topbar.run")}</button>
        <button type="button" disabled={busy} onClick={onRefresh} aria-label={t("topbar.refreshSessions")}>{t("topbar.refresh")}</button>
      </div>
    </header>
  );
}
