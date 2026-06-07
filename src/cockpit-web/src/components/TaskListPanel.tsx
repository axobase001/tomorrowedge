import type { CockpitTaskSummary } from "../../../cockpit/contracts.js";
import type { CockpitSessionSummary } from "../api.js";
import { StatusChip } from "./StatusChip.js";

export function TaskListPanel({
  tasks,
  sessions,
  selectedSession,
  onSelectSession,
  onNewTask
}: {
  tasks: CockpitTaskSummary[];
  sessions: CockpitSessionSummary[];
  selectedSession: string;
  onSelectSession: (sessionId: string) => void;
  onNewTask: () => void;
}) {
  return (
    <aside className="te-panel te-task-panel">
      <header><h2>任务</h2><button type="button" aria-label="New task" onClick={onNewTask}>+</button></header>
      <select value={selectedSession} onChange={(event) => onSelectSession(event.target.value)} aria-label="session selector">
        {sessions.length ? sessions.map((session) => (
          <option key={session.sessionId} value={session.sessionId}>{session.sessionId}</option>
        )) : <option value="latest">latest</option>}
      </select>
      <div className="te-task-list">
        {tasks.map((task) => (
          <article key={task.id} className={task.selected ? "selected" : ""}>
            <div><strong>{task.title}</strong><StatusChip status={task.status} /></div>
            <p>{task.reminder}</p>
            <small>{task.updatedAt}</small>
          </article>
        ))}
      </div>
    </aside>
  );
}
