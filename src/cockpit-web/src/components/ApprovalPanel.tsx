import type { CockpitApproval, CockpitApprovalIntent } from "../../../cockpit/contracts.js";
import { StatusChip } from "./StatusChip.js";

export function ApprovalPanel({ approval, busy, onApproval, onOpenDrawer }: { approval: CockpitApproval; busy: boolean; onApproval: (action: CockpitApprovalIntent["action"]) => void; onOpenDrawer: () => void }) {
  const approveAction = approval.kind === "shell" ? "approve_shell" : "approve_patch";
  const rejectAction = approval.kind === "shell" ? "reject_shell" : "reject_patch";
  return (
    <article className="te-approval">
      <header>
        <h3>{approval.title}</h3>
        <StatusChip status={approval.riskLevel ?? "low"} />
        <StatusChip status={approval.testStatus ?? "not_run"} />
      </header>
      <p>{approval.summary}</p>
      <small>{approval.filesChanged.length} file · full diff in drawer</small>
      <footer>
        <button type="button" disabled={busy} onClick={() => onApproval(approveAction)}>批准</button>
        <button type="button" disabled={busy} onClick={() => onApproval(rejectAction)}>拒绝</button>
        <button type="button" disabled={busy} onClick={() => onApproval("request_re_review")}>再看</button>
        <button type="button" onClick={onOpenDrawer}>详情</button>
      </footer>
    </article>
  );
}
