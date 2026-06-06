import type { CockpitViewModel } from "../../../cockpit/contracts.js";
import { ApprovalPanel } from "./ApprovalPanel.js";
import { StatusChip } from "./StatusChip.js";

export function WorkflowPanel({ viewModel }: { viewModel: CockpitViewModel }) {
  return (
    <section className="te-panel te-workflow">
      <header><h2>工作流</h2><StatusChip status={viewModel.statusText} /></header>
      <nav className="te-spine">
        {viewModel.workflow.map((step) => (
          <span key={step.id} className={step.status}>{step.label}</span>
        ))}
      </nav>
      {viewModel.currentApproval ? (
        <ApprovalPanel approval={viewModel.currentApproval} />
      ) : (
        <article className="te-main">
          <h3>{viewModel.main.title}</h3>
          <p>{viewModel.main.subtitle}</p>
          <pre>{viewModel.main.diff ?? viewModel.main.body}</pre>
        </article>
      )}
    </section>
  );
}
