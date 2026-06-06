export function ComposerPanel() {
  return (
    <section className="te-panel te-composer">
      <strong>自然语言指令</strong>
      <textarea placeholder="输入任务、约束或审批反馈…" />
      <span className="te-chip">mode: partial</span>
      <span className="te-chip">target: planner</span>
      <button>Send</button>
    </section>
  );
}
