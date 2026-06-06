import type { KeyboardEvent } from "react";

export function ComposerPanel() {
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <form className="te-panel te-composer">
      <strong>自然语言指令</strong>
      <textarea onKeyDown={onKeyDown} placeholder="输入任务、约束或审批反馈…" />
      <span className="te-chip">mode: partial</span>
      <span className="te-chip">target: planner</span>
      <button>Send</button>
    </form>
  );
}
