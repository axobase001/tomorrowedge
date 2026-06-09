import type { KeyboardEvent } from "react";
import type { AccessMode } from "../../../config/schema.js";
import type { Translator } from "../i18n.js";

export type ComposerTarget = "core" | "planner" | "reviewer" | "judge" | "coder" | "repairer" | "debate";

const composerTargets: Array<{ value: ComposerTarget; label: string }> = [
  { value: "core", label: "core" },
  { value: "planner", label: "planner" },
  { value: "reviewer", label: "reviewer" },
  { value: "judge", label: "judge" },
  { value: "coder", label: "coder" },
  { value: "repairer", label: "repairer" },
  { value: "debate", label: "debate" }
];

export function ComposerPanel({
  goal,
  accessMode,
  conversationTarget,
  busy,
  statusMessage,
  t,
  onGoalChange,
  onAccessModeChange,
  onConversationTargetChange,
  onSubmit
}: {
  goal: string;
  accessMode: AccessMode;
  conversationTarget: ComposerTarget;
  busy: boolean;
  statusMessage?: string;
  t: Translator;
  onGoalChange: (goal: string) => void;
  onAccessModeChange: (mode: AccessMode) => void;
  onConversationTargetChange: (target: ComposerTarget) => void;
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
        <span>{t("composer.target")}</span>
        <select
          value={conversationTarget}
          onChange={(event) => onConversationTargetChange(event.target.value as ComposerTarget)}
          title={t("composer.targetHelp")}
          aria-label={t("composer.target")}
          data-testid="composer-target"
        >
          {composerTargets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}
        </select>
      </label>
      {statusMessage ? <span className="te-composer-status" data-testid="composer-status">{statusMessage}</span> : null}
      <button type="submit" disabled={busy || isEmpty} data-testid="composer-submit">{t("composer.send")}</button>
    </form>
  );
}
