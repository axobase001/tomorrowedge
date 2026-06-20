import type { CockpitApprovalIntent, CockpitViewModel } from "../../../cockpit/contracts.js";
import type { Translator } from "../i18n.js";
import { translateKnownValue } from "../i18n.js";
import { ApprovalPanel } from "./ApprovalPanel.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { EmptyState, LoadingState } from "./StateNotice.js";
import { StatusChip } from "./StatusChip.js";

export function WorkflowPanel({ viewModel, busy, t, onApproval, onOpenDrawer }: { viewModel: CockpitViewModel; busy: boolean; t: Translator; onApproval: (action: CockpitApprovalIntent["action"]) => void; onOpenDrawer: () => void }) {
  const runningAgent = viewModel.agents?.find((a) => a.status === "running");
  const activePhases = ["planning", "routing", "editing", "reviewing", "testing"] as string[];
  const isActive = activePhases.includes(viewModel.status) || viewModel.statusText === "Running";
  const governanceActive = Boolean(viewModel.chiefAgent || viewModel.council || viewModel.taskOwnership || viewModel.finalReview);

  return (
    <section className="te-panel te-workflow" data-testid="workflow-panel">
      <header>
        <h2>{t("workflow.title")}</h2>
        <div>
          <StatusChip status={viewModel.statusText} t={t} />
          <button type="button" onClick={onOpenDrawer} data-testid="open-drawer">{t("workflow.details")}</button>
        </div>
      </header>
      <ol className="te-spine" aria-label={t("workflow.title")} data-testid="workflow-spine">
        {viewModel.workflow.length ? viewModel.workflow.map((step) => (
          <li key={step.id} className={step.status}>
            <span>{translateKnownValue(t, step.label)}</span>
            <small>{translateKnownValue(t, step.status)}</small>
          </li>
        )) : (
          <li className="te-spine-empty">
            <EmptyState title={t("state.noWorkflow")} detail={t("state.noWorkflowDetail")} testId="workflow-empty-state" />
          </li>
        )}
      </ol>
      <div className="te-workflow-body" data-testid="workflow-body">
        {busy && !viewModel.currentApproval ? <LoadingState label={t("state.workflowUpdating")} testId="workflow-loading-state" /> : null}
        {isActive && (
          <div className="te-workflow-status" data-testid="workflow-current-agent">
            {runningAgent
              ? t("workflow.current", { role: runningAgent.role, provider: runningAgent.provider, model: runningAgent.model })
              : t("workflow.waitingNextAgent")}
          </div>
        )}
        {governanceActive ? (
          <section className="te-governance-strip" data-testid="governance-strip" aria-label={t("workflow.councilGovernance")}>
            <div><span>{t("workflow.chief")}</span><strong>{viewModel.chiefAgent?.chiefAgentId ?? "-"}</strong></div>
            <div><span>{t("workflow.council")}</span><strong>{t("workflow.agentsCount", { count: viewModel.council?.members.length ?? 0 })}</strong></div>
            <div><span>{t("workflow.ownership")}</span><strong>{t("workflow.tasksCount", { count: viewModel.taskOwnership?.assignments.length ?? 0 })}</strong></div>
            <div><span>{t("workflow.mutations")}</span><strong>{viewModel.policyMutations?.count ?? 0}</strong></div>
            <div><span>{t("workflow.final")}</span><strong>{viewModel.finalReview?.decision ?? "-"}</strong></div>
          </section>
        ) : null}
        {viewModel.currentApproval ? (
          <ApprovalPanel approval={viewModel.currentApproval} busy={busy} t={t} onApproval={onApproval} onOpenDrawer={onOpenDrawer} />
        ) : (
          <article className="te-main" data-testid="main-view">
            <h3>{translateKnownValue(t, viewModel.main.title)}</h3>
            <p>{translateKnownValue(t, viewModel.main.subtitle)}</p>
            <MainDeliverables viewModel={viewModel} t={t} />
            {shouldRenderMainBody(viewModel) ? <MarkdownContent className="te-main-answer" content={viewModel.main.diff ?? viewModel.main.body} t={t} /> : null}
            {viewModel.main.supportingDetail ? (
              <details className="te-main-support">
                <summary>{t("workflow.details")}</summary>
                <MarkdownContent className="te-main-support-body" content={viewModel.main.supportingDetail} t={t} />
              </details>
            ) : null}
          </article>
        )}
      </div>
    </section>
  );
}

function MainDeliverables({ viewModel, t }: { viewModel: CockpitViewModel; t: Translator }) {
  const deliverables = viewModel.main.deliverables ?? [];
  if (!deliverables.length) return null;
  const files = deliverables.filter((item) => item.type === "file");
  const codeBlocks = deliverables.filter((item) => item.type === "code");
  return (
    <section className="te-deliverables" data-testid="main-deliverables" aria-label={t("workflow.deliverables")}>
      <h4>{t("workflow.deliverables")}</h4>
      {files.length ? (
        <ul className="te-deliverable-files">
          {files.map((item) => (
            <li key={item.path}>
              <span>{t("workflow.fileDeliverable")}</span>
              {item.artifactRef
                ? <a href={artifactHref(viewModel.sessionId, item.artifactRef)} target="_blank" rel="noreferrer">{item.path}</a>
                : <code>{item.path}</code>}
            </li>
          ))}
        </ul>
      ) : null}
      {codeBlocks.map((item, index) => (
        <MarkdownContent key={`${item.language}-${index}`} className="te-deliverable-code" content={codeDeliverableMarkdown(item.language, item.content)} t={t} />
      ))}
    </section>
  );
}

function shouldRenderMainBody(viewModel: CockpitViewModel): boolean {
  const content = viewModel.main.diff ?? viewModel.main.body;
  if (!content.trim()) return false;
  return !(viewModel.main.deliverables ?? []).some((item) => item.type === "code" && item.content.trim() === content.trim());
}

function codeDeliverableMarkdown(language: string, content: string): string {
  return [`\`\`\`${language}`, content.trim(), "```"].join("\n");
}

function artifactHref(sessionId: string | undefined, ref: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId ?? "latest")}/artifacts/${encodeURIComponent(ref)}`;
}
