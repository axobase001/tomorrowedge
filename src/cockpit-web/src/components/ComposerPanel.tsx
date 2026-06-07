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
    <form className="te-panel te-composer" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <strong>自然语言指令</strong>
      <textarea value={goal} onChange={(event) => onGoalChange(event.target.value)} onKeyDown={onKeyDown} placeholder="输入任务、约束或审批反馈…" />
      <span className="te-chip">mode: partial</span>
      <span className="te-chip">target: core</span>
      {statusMessage ? <span className="te-composer-status">{statusMessage}</span> : null}
      <button type="submit" disabled={busy}>Send</button>
    </form>
  );
}
