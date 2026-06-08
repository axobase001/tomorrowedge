import type { KeyboardEvent } from "react";
import type { AccessMode } from "../../../config/schema.js";
import type { Translator } from "../i18n.js";

export function ComposerPanel({
  goal,
  accessMode,
  busy,
  statusMessage,
  t,
  onGoalChange,
  onAccessModeChange,
  onSubmit
}: {
  goal: string;
  accessMode: AccessMode;
  busy: boolean;
  statusMessage?: string;
  t: Translator;
  onGoalChange: (goal: string) => void;
  onAccessModeChange: (mode: AccessMode) => void;
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
      <span className="te-chip">{t("composer.targetCore")}</span>
      {statusMessage ? <span className="te-composer-status" data-testid="composer-status">{statusMessage}</span> : null}
      <button type="submit" disabled={busy || isEmpty} data-testid="composer-submit">{t("composer.send")}</button>
    </form>
  );
}
