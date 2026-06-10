import type { CockpitApprovalIntent, CockpitViewModel } from "../../../cockpit/contracts.js";
import type { Translator } from "../i18n.js";
import { translateKnownValue } from "../i18n.js";
import { ApprovalPanel } from "./ApprovalPanel.js";
import { StatusChip } from "./StatusChip.js";

export function WorkflowPanel({ viewModel, busy, t, onApproval, onOpenDrawer }: { viewModel: CockpitViewModel; busy: boolean; t: Translator; onApproval: (action: CockpitApprovalIntent["action"]) => void; onOpenDrawer: () => void }) {
  const runningAgent = viewModel.agents?.find((a) => a.status === "running");
  const activePhases = ["planning", "routing", "editing", "reviewing", "testing"] as string[];
  const isActive = activePhases.includes(viewModel.status) || viewModel.statusText === "Running";

  return (
    <section className="te-panel te-workflow" data-testid="workflow-panel">
      <header>
        <h2>{t("workflow.title")}</h2>
        <div>
          <StatusChip status={viewModel.statusText} t={t} />
          <button type="button" onClick={onOpenDrawer} data-testid="open-drawer">{t("workflow.details")}</button>
        </div>
      </header>
      <nav className="te-spine" data-testid="workflow-spine">
        {viewModel.workflow.map((step) => (
          <span key={step.id} className={step.status}>{step.label}</span>
        ))}
      </nav>
      {isActive && (
        <div className="te-workflow-status" data-testid="workflow-current-agent">
          {runningAgent
            ? t("workflow.current", { role: runningAgent.role, provider: runningAgent.provider, model: runningAgent.model })
            : t("workflow.waitingNextAgent")}
        </div>
      )}
      {viewModel.currentApproval ? (
        <ApprovalPanel approval={viewModel.currentApproval} busy={busy} t={t} onApproval={onApproval} onOpenDrawer={onOpenDrawer} />
      ) : (
        <article className="te-main" data-testid="main-view">
          <h3>{translateKnownValue(t, viewModel.main.title)}</h3>
          <p>{translateKnownValue(t, viewModel.main.subtitle)}</p>
          <pre className="te-main-answer">{viewModel.main.diff ?? viewModel.main.body}</pre>
          {viewModel.main.supportingDetail ? (
            <details className="te-main-support">
              <summary>{t("workflow.details")}</summary>
              <pre>{viewModel.main.supportingDetail}</pre>
            </details>
          ) : null}
        </article>
      )}
    </section>
  );
}
