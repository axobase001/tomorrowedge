import type { KeyboardEvent } from "react";
import type { AccessMode } from "../../../config/schema.js";

export function ComposerPanel({
  goal,
  accessMode,
  busy,
  statusMessage,
  onGoalChange,
  onAccessModeChange,
  onSubmit
}: {
  goal: string;
  accessMode: AccessMode;
  busy: boolean;
  statusMessage?: string;
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
      <strong>Command</strong>
      <textarea value={goal} onChange={(event) => onGoalChange(event.target.value)} onKeyDown={onKeyDown} placeholder="Describe a task, constraint, or approval feedback..." data-testid="composer-input" />
      {isEmpty && <span data-testid="composer-validation-hint">Type a task to begin</span>}
      <label className="te-mode-control">
        <span>mode</span>
        <select
          value={accessMode}
          onChange={(event) => onAccessModeChange(event.target.value as AccessMode)}
          title="restricted disables file/shell actions, partial asks for approval, full allows autonomous patch/shell/repair with trace."
          aria-label="Access mode" data-testid="composer-mode"
        >
          <option value="restricted">restricted</option>
          <option value="partial">partial</option>
          <option value="full">full</option>
        </select>
      </label>
      <span className="te-chip">target: core</span>
      {statusMessage ? <span className="te-composer-status" data-testid="composer-status">{statusMessage}</span> : null}
      <button type="submit" disabled={busy || isEmpty} data-testid="composer-submit">Send</button>
    </form>
  );
}
