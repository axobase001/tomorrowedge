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
  target,
  busy,
  statusMessage,
  t,
  onGoalChange,
  onAccessModeChange,
  onRunModeChange,
  onTargetChange,
  onSubmit
}: {
  goal: string;
  accessMode: AccessMode;
  runMode: CockpitRunMode;
  target: string;
  busy: boolean;
  statusMessage?: string;
  t: Translator;
  onGoalChange: (goal: string) => void;
  onAccessModeChange: (mode: AccessMode) => void;
  onRunModeChange: (mode: CockpitRunMode) => void;
  onTargetChange: (target: string) => void;
  onSubmit: () => void;
}) {
  const isEmpty = goal.trim().length === 0;

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (isEmpty) return;
    onSubmit();
  };

  return (
    <form className="te-panel te-composer" onSubmit={(event) => { event.preventDefault(); if (!isEmpty) onSubmit(); }} data-testid="composer">
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
      {statusMessage ? <span className="te-composer-status" data-testid="composer-status">{statusMessage}</span> : null}
      <button type="submit" disabled={busy || isEmpty} data-testid="composer-submit">{t("composer.send")}</button>
    </form>
  );
}

function normalizeComposerTarget(value: string): ComposerTarget {
  return composerTargets.includes(value as ComposerTarget) ? value as ComposerTarget : "core";
}
