import type { CockpitTaskSummary } from "../../../cockpit/contracts.js";
import type { CockpitSessionSummary } from "../api.js";
import type { Translator } from "../i18n.js";
import { StatusChip } from "./StatusChip.js";

export function TaskListPanel({
  tasks,
  sessions,
  selectedSession,
  t,
  onSelectSession,
  onNewTask
}: {
  tasks: CockpitTaskSummary[];
  sessions: CockpitSessionSummary[];
  selectedSession: string;
  t: Translator;
  onSelectSession: (sessionId: string) => void;
  onNewTask: () => void;
}) {
  const selectedInList = sessions.some((session) => session.sessionId === selectedSession);

  return (
    <aside className="te-panel te-task-panel" data-testid="task-panel">
      <header><h2>{t("tasks.title")}</h2><button type="button" aria-label={t("tasks.new")} onClick={onNewTask}>+</button></header>
      <select value={selectedSession} aria-label={t("tasks.selectSession")} onChange={(event) => onSelectSession(event.target.value)}>
        {!sessions.length && selectedSession === "latest" ? <option value="latest">latest</option> : null}
        {selectedSession !== "latest" && !selectedInList ? <option value={selectedSession}>{selectedSession}</option> : null}
        {sessions.map((session) => (
          <option key={session.sessionId} value={session.sessionId}>{session.sessionId}</option>
        ))}
      </select>
      <div className="te-task-list">
        {tasks.map((task) => (
          <article key={task.id} className={task.selected ? "selected" : ""} data-testid="task-card">
            <div><strong title={task.title}>{task.title}</strong><StatusChip status={task.status} t={t} /></div>
            <p>{task.reminder}</p>
            <small>{task.updatedAt}</small>
          </article>
        ))}
      </div>
    </aside>
  );
}
