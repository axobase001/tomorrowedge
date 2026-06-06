import type { CockpitTaskSummary } from "../../../cockpit/contracts.js";
import { StatusChip } from "./StatusChip.js";

export function TaskListPanel({ tasks }: { tasks: CockpitTaskSummary[] }) {
  return (
    <aside className="te-panel te-task-panel">
      <header><h2>任务</h2><button>+</button></header>
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
