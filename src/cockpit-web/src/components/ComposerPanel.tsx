import type { KeyboardEvent } from "react";

export function ComposerPanel({
  goal,
  busy,
  statusMessage,
  onGoalChange,
  onSubmit
}: {
  goal: string;
  busy: boolean;
  statusMessage?: string;
  onGoalChange: (goal: string) => void;
  onSubmit: () => void;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    onSubmit();
  };

  return (
    <form className="te-panel te-composer" onSubmit={(event) => { event.preventDefault(); onSubmit(); }} data-testid="composer">
      <strong>Command</strong>
      <textarea value={goal} onChange={(event) => onGoalChange(event.target.value)} onKeyDown={onKeyDown} placeholder="Describe a task, constraint, or approval feedback..." data-testid="composer-input" />
      <span className="te-chip">mode: partial</span>
      <span className="te-chip">target: core</span>
      {statusMessage ? <span className="te-composer-status" data-testid="composer-status">{statusMessage}</span> : null}
      <button type="submit" disabled={busy} data-testid="composer-submit">Send</button>
    </form>
  );
}
