import type { KeyboardEvent } from "react";
import type { CockpitRunMode } from "../../../cockpit/contracts.js";
import type { AccessMode } from "../../../config/schema.js";
import type { Translator } from "../i18n.js";

const composerTargets = ["core", "planner", "reviewer", "judge", "coder", "repairer", "debate"] as const;
type ComposerTarget = typeof composerTargets[number];

export function ComposerPanel({
  goal,
  accessMode,
  runMode,
  runPreview,
  target,
  testCommand,
  repairOnFail,
  fixtureFailingPatch,
  fullAutonomyConfirmed,
  busy,
  statusMessage,
  t,
  onGoalChange,
  onAccessModeChange,
  onRunModeChange,
  onTestCommandChange,
  onRepairOnFailChange,
  onFixtureFailingPatchChange,
  onFullAutonomyConfirmedChange,
  onTargetChange,
  onSubmit,
  onCancelRun
}: {
  goal: string;
  accessMode: AccessMode;
  runMode: CockpitRunMode;
  runPreview?: string;
  target: string;
  testCommand: string;
  repairOnFail: boolean;
  fixtureFailingPatch: boolean;
  fullAutonomyConfirmed: boolean;
  busy: boolean;
  statusMessage?: string;
  t: Translator;
  onGoalChange: (goal: string) => void;
  onAccessModeChange: (mode: AccessMode) => void;
  onRunModeChange: (mode: CockpitRunMode) => void;
  onTestCommandChange: (command: string) => void;
  onRepairOnFailChange: (enabled: boolean) => void;
  onFixtureFailingPatchChange: (enabled: boolean) => void;
  onFullAutonomyConfirmedChange: (enabled: boolean) => void;
  onTargetChange: (target: string) => void;
  onSubmit: () => void;
  onCancelRun: () => void;
}) {
  const isEmpty = goal.trim().length === 0;
  const needsFullPreflight = accessMode === "full";
  const canSubmit = !busy && !isEmpty && (!needsFullPreflight || fullAutonomyConfirmed);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit();
  };

  return (
    <form className="te-panel te-composer" onSubmit={(event) => { event.preventDefault(); if (canSubmit) onSubmit(); }} data-testid="composer">
      <strong>{t("composer.title")}</strong>
      <textarea value={goal} onChange={(event) => onGoalChange(event.target.value)} onKeyDown={onKeyDown} placeholder={t("composer.placeholder")} data-testid="composer-input" />
      {isEmpty && <span data-testid="composer-validation-hint">{t("composer.empty")}</span>}
      <label className="te-mode-control">
        <span>{t("composer.mode")}</span>
        <select
          value={accessMode}
          onChange={(event) => onAccessModeChange(event.target.value as AccessMode)}
          title={t("composer.modeHelp")}
          aria-label={t("composer.accessMode")} data-testid="composer-mode"
        >
          <option value="restricted">restricted</option>
          <option value="partial">partial</option>
          <option value="full">full</option>
        </select>
      </label>
      <label className="te-mode-control">
        <span>{t("composer.runMode")}</span>
        <select
          value={runMode}
          onChange={(event) => onRunModeChange(event.target.value as CockpitRunMode)}
          title={t("composer.runModeHelp")}
          aria-label={t("composer.runMode")}
          data-testid="composer-run-mode"
        >
          <option value="auto">{t("composer.runModeAuto")}</option>
          <option value="fixture">{t("composer.runModeFixture")}</option>
          <option value="offline">{t("composer.runModeOffline")}</option>
          <option value="live">{t("composer.runModeLive")}</option>
          <option value="council">{t("composer.runModeCouncil")}</option>
        </select>
      </label>
      <label className="te-mode-control">
        <span>{t("composer.target")}</span>
        <select
          value={normalizeComposerTarget(target)}
          onChange={(event) => onTargetChange(event.target.value)}
          title={t("composer.targetHelp")}
          aria-label={t("composer.target")}
          data-testid="composer-target"
        >
          {composerTargets.map((item) => <option value={item} key={item}>{item}</option>)}
        </select>
      </label>
      {runPreview ? <span className="te-run-preview" data-testid="composer-run-preview">{runPreview}</span> : null}
      {needsFullPreflight ? (
        <section className="te-full-preflight" data-testid="composer-full-preflight" aria-live="polite">
          <strong>{t("composer.fullPreflightTitle")}</strong>
          <p>{t("composer.fullPreflightBody")}</p>
          <label className="te-run-settings-check">
            <input
              type="checkbox"
              checked={fullAutonomyConfirmed}
              onChange={(event) => onFullAutonomyConfirmedChange(event.target.checked)}
              data-testid="composer-full-preflight-check"
            />
            <span>{t("composer.fullPreflightConfirm")}</span>
          </label>
        </section>
      ) : null}
      <details className="te-run-settings" data-testid="composer-run-settings">
        <summary>{t("composer.runSettings")}</summary>
        <label>
          <span>{t("composer.testCommand")}</span>
          <input
            value={testCommand}
            onChange={(event) => onTestCommandChange(event.target.value)}
            placeholder={t("composer.testCommandPlaceholder")}
            data-testid="composer-test-command"
          />
        </label>
        <label className="te-run-settings-check">
          <input
            type="checkbox"
            checked={repairOnFail}
            onChange={(event) => onRepairOnFailChange(event.target.checked)}
            data-testid="composer-repair-on-fail"
          />
          <span>{t("composer.repairOnFail")}</span>
        </label>
        <label className="te-run-settings-check">
          <input
            type="checkbox"
            checked={fixtureFailingPatch}
            onChange={(event) => onFixtureFailingPatchChange(event.target.checked)}
            data-testid="composer-fixture-failing-patch"
          />
          <span>{t("composer.fixtureFailingPatch")}</span>
        </label>
      </details>
      {statusMessage ? <span className="te-composer-status" data-testid="composer-status">{statusMessage}</span> : null}
      {busy ? (
        <button type="button" className="te-danger-button" onClick={onCancelRun} data-testid="composer-cancel-run">{t("composer.cancelRun")}</button>
      ) : (
        <button type="submit" disabled={!canSubmit} data-testid="composer-submit">{submitLabel(accessMode, t)}</button>
      )}
    </form>
  );
}

function submitLabel(accessMode: AccessMode, t: Translator): string {
  if (accessMode === "full") return t("composer.runFull");
  if (accessMode === "restricted") return t("composer.runRestricted");
  return t("composer.runSupervised");
}

function normalizeComposerTarget(value: string): ComposerTarget {
  return composerTargets.includes(value as ComposerTarget) ? value as ComposerTarget : "core";
}
