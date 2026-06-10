import type { CockpitApproval, CockpitApprovalIntent } from "../../../cockpit/contracts.js";
import type { Translator } from "../i18n.js";
import { LoadingState } from "./StateNotice.js";
import { StatusChip } from "./StatusChip.js";

export function ApprovalPanel({ approval, busy, t, onApproval, onOpenDrawer }: { approval: CockpitApproval; busy: boolean; t: Translator; onApproval: (action: CockpitApprovalIntent["action"]) => void; onOpenDrawer: () => void }) {
  const approveAction = approval.kind === "shell" ? "approve_shell" : "approve_patch";
  const rejectAction = approval.kind === "shell" ? "reject_shell" : "reject_patch";
  return (
    <article className="te-approval" data-testid="approval-card">
      <header>
        <h3>{approval.title}</h3>
        <StatusChip status={approval.riskLevel ?? "low"} t={t} />
        <StatusChip status={approval.testStatus ?? "not_run"} t={t} />
      </header>
      <p>{approval.summary}</p>
      <small>{t("approval.changedFiles", { count: approval.filesChanged.length })}</small>
      {busy ? <LoadingState label={t("state.approvalApplying")} testId="approval-loading-state" /> : null}
      <footer>
        <button type="button" disabled={busy} onClick={() => onApproval(approveAction)} data-testid="approval-approve">{t("approval.approve")}</button>
        <button type="button" disabled={busy} onClick={() => onApproval(rejectAction)} data-testid="approval-reject">{t("approval.reject")}</button>
        <button type="button" disabled={busy} onClick={() => onApproval("request_re_review")} data-testid="approval-rereview">{t("approval.rereview")}</button>
        <button type="button" onClick={onOpenDrawer} data-testid="approval-open-drawer">{t("approval.details")}</button>
      </footer>
    </article>
  );
}
