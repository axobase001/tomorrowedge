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
      <nav className="te-spine" data-testid="workflow-spine">
        {viewModel.workflow.length ? viewModel.workflow.map((step) => (
          <span key={step.id} className={step.status}>{step.label}</span>
        )) : (
          <EmptyState title={t("state.noWorkflow")} detail={t("state.noWorkflowDetail")} testId="workflow-empty-state" />
        )}
      </nav>
      {busy && !viewModel.currentApproval ? <LoadingState label={t("state.workflowUpdating")} testId="workflow-loading-state" /> : null}
      {isActive && (
        <div className="te-workflow-status" data-testid="workflow-current-agent">
          {runningAgent
            ? t("workflow.current", { role: runningAgent.role, provider: runningAgent.provider, model: runningAgent.model })
            : t("workflow.waitingNextAgent")}
        </div>
      )}
      {governanceActive ? (
        <section className="te-governance-strip" data-testid="governance-strip" aria-label="Agent Council governance">
          <div><span>Chief</span><strong>{viewModel.chiefAgent?.chiefAgentId ?? "-"}</strong></div>
          <div><span>Council</span><strong>{viewModel.council?.members.length ?? 0} agents</strong></div>
          <div><span>Ownership</span><strong>{viewModel.taskOwnership?.assignments.length ?? 0} tasks</strong></div>
          <div><span>Mutations</span><strong>{viewModel.policyMutations?.count ?? 0}</strong></div>
          <div><span>Final</span><strong>{viewModel.finalReview?.decision ?? "-"}</strong></div>
        </section>
      ) : null}
      {viewModel.currentApproval ? (
        <ApprovalPanel approval={viewModel.currentApproval} busy={busy} t={t} onApproval={onApproval} onOpenDrawer={onOpenDrawer} />
      ) : (
        <article className="te-main" data-testid="main-view">
          <h3>{translateKnownValue(t, viewModel.main.title)}</h3>
          <p>{translateKnownValue(t, viewModel.main.subtitle)}</p>
          <MainDeliverables viewModel={viewModel} />
          {shouldRenderMainBody(viewModel) ? <MarkdownContent className="te-main-answer" content={viewModel.main.diff ?? viewModel.main.body} /> : null}
          {viewModel.main.supportingDetail ? (
            <details className="te-main-support">
              <summary>{t("workflow.details")}</summary>
              <MarkdownContent className="te-main-support-body" content={viewModel.main.supportingDetail} />
            </details>
          ) : null}
        </article>
      )}
    </section>
  );
}

function MainDeliverables({ viewModel }: { viewModel: CockpitViewModel }) {
  const deliverables = viewModel.main.deliverables ?? [];
  if (!deliverables.length) return null;
  const files = deliverables.filter((item) => item.type === "file");
  const codeBlocks = deliverables.filter((item) => item.type === "code");
  return (
    <section className="te-deliverables" data-testid="main-deliverables" aria-label="Deliverables">
      <h4>Deliverables</h4>
      {files.length ? (
        <ul className="te-deliverable-files">
          {files.map((item) => (
            <li key={item.path}>
              <span>File</span>
              {item.artifactRef
                ? <a href={artifactHref(viewModel.sessionId, item.artifactRef)} target="_blank" rel="noreferrer">{item.path}</a>
                : <code>{item.path}</code>}
            </li>
          ))}
        </ul>
      ) : null}
      {codeBlocks.map((item, index) => (
        <MarkdownContent key={`${item.language}-${index}`} className="te-deliverable-code" content={codeDeliverableMarkdown(item.language, item.content)} />
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
