import type { CockpitTaskSummary } from "../../../cockpit/contracts.js";
import type { CockpitSessionSummary } from "../api.js";
import type { Translator } from "../i18n.js";
import { EmptyState } from "./StateNotice.js";
import { StatusChip } from "./StatusChip.js";

export function TaskListPanel({
  tasks,
  sessions,
  selectedSession,
  t,
  onSelectSession,
  onNewTask,
  onRenameSession,
  onDeleteSession
}: {
  tasks: CockpitTaskSummary[];
  sessions: CockpitSessionSummary[];
  selectedSession: string;
  t: Translator;
  onSelectSession: (sessionId: string) => void;
  onNewTask: () => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onDeleteSession: (sessionId: string) => void;
}) {
  const selectedInList = sessions.some((session) => session.sessionId === selectedSession);
  const selected = sessions.find((session) => session.sessionId === selectedSession);

  return (
    <aside className="te-panel te-task-panel" data-testid="task-panel">
      <header><h2>{t("tasks.title")}</h2><button type="button" aria-label={t("tasks.new")} onClick={onNewTask}>+</button></header>
      <select value={selectedSession} aria-label={t("tasks.selectSession")} onChange={(event) => onSelectSession(event.target.value)}>
        {!sessions.length && selectedSession === "latest" ? <option value="latest">latest</option> : null}
        {selectedSession !== "latest" && !selectedInList ? <option value={selectedSession}>{selectedSession}</option> : null}
        {sessions.map((session) => (
          <option key={session.sessionId} value={session.sessionId}>{sessionLabel(session)}</option>
        ))}
      </select>
      {selected ? (
        <div className="te-session-actions" data-testid="session-actions">
          <button type="button" onClick={() => {
            const nextTitle = window.prompt(t("tasks.renamePrompt"), selected.goal ?? selected.sessionId);
            if (nextTitle?.trim()) onRenameSession(selected.sessionId, nextTitle.trim());
          }}>{t("tasks.rename")}</button>
          <button type="button" className="te-quiet-button" onClick={() => {
            if (window.confirm(t("tasks.deletePrompt"))) onDeleteSession(selected.sessionId);
          }}>{t("tasks.delete")}</button>
        </div>
      ) : null}
      <div className="te-task-list">
        {tasks.length ? tasks.map((task) => (
          <article key={task.id} className={task.selected ? "selected" : ""} data-testid="task-card">
            <div><strong title={task.title}>{task.title}</strong><StatusChip status={task.status} t={t} /></div>
            <p>{task.reminder}</p>
            <small>{task.updatedAt}</small>
          </article>
        )) : (
          <EmptyState title={t("state.noTasks")} detail={t("state.noTasksDetail")} testId="task-empty-state" />
        )}
      </div>
    </aside>
  );
}

function sessionLabel(session: CockpitSessionSummary): string {
  const title = session.goal?.trim() ? session.goal.trim() : session.sessionId;
  const clipped = title.length > 54 ? `${title.slice(0, 51)}...` : title;
  const result = session.result ? ` · ${session.result}` : "";
  return `${clipped}${result}`;
}
