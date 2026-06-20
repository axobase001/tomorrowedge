import type { KeyboardEvent } from "react";
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
  const selectRelativeSession = (event: KeyboardEvent<HTMLButtonElement>, index: number, direction: -1 | 1) => {
    if (!sessions.length) return;
    event.preventDefault();
    const nextIndex = Math.min(Math.max(index + direction, 0), sessions.length - 1);
    const nextSession = sessions[nextIndex];
    onSelectSession(nextSession.sessionId);
    requestAnimationFrame(() => {
      const nextButton = document.querySelectorAll<HTMLButtonElement>("[data-testid='session-history-item']")[nextIndex];
      nextButton?.focus();
    });
  };

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
      {sessions.length ? (
        <section className="te-session-section" aria-labelledby="te-recent-runs-title">
          <div className="te-section-heading">
            <h3 id="te-recent-runs-title">{t("tasks.recentRuns")}</h3>
            <span>{t("tasks.recentRunsCount", { count: sessions.length })}</span>
          </div>
          <div className="te-session-history" aria-label={t("tasks.recentRuns")} data-testid="session-history">
            {sessions.map((session, index) => {
              const selectedSessionItem = session.sessionId === selectedSession;
              return (
                <button
                  type="button"
                  key={session.sessionId}
                  className={selectedSessionItem ? "selected" : ""}
                  aria-current={selectedSessionItem ? "true" : undefined}
                  tabIndex={selectedSessionItem ? 0 : -1}
                  onClick={() => onSelectSession(session.sessionId)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") selectRelativeSession(event, index, 1);
                    if (event.key === "ArrowUp") selectRelativeSession(event, index, -1);
                  }}
                  data-testid="session-history-item"
                >
                  <span>
                    <strong title={sessionTitle(session)}>{clipSessionTitle(sessionTitle(session))}</strong>
                    <small>{formatSessionTime(session.createdAt)}</small>
                  </span>
                  <span className="te-session-meta">
                    <span className="te-chip te-chip-blue">{session.result ?? t("status.pending")}</span>
                    <small>{t("tasks.sessionCounts", { events: session.eventCount ?? 0, artifacts: session.artifactCount ?? 0 })}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
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
      <section className="te-current-tasks" aria-labelledby="te-current-tasks-title">
        <div className="te-section-heading">
          <h3 id="te-current-tasks-title">{t("tasks.currentTasks")}</h3>
          <span>{t("tasks.currentTasksCount", { count: tasks.length })}</span>
        </div>
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
      </section>
    </aside>
  );
}

function sessionLabel(session: CockpitSessionSummary): string {
  const title = sessionTitle(session);
  const clipped = clipSessionTitle(title);
  const result = session.result ? ` · ${session.result}` : "";
  return `${clipped}${result}`;
}

function sessionTitle(session: CockpitSessionSummary): string {
  return session.goal?.trim() ? session.goal.trim() : session.sessionId;
}

function clipSessionTitle(title: string): string {
  return title.length > 54 ? `${title.slice(0, 51)}...` : title;
}

function formatSessionTime(createdAt: string): string {
  if (!createdAt.includes("T")) return createdAt;
  return `${createdAt.slice(0, 10)} ${createdAt.slice(11, 16)}`;
}
