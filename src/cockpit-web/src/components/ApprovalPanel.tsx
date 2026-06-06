import type { CockpitApproval } from "../../../cockpit/contracts.js";
import { StatusChip } from "./StatusChip.js";

export function ApprovalPanel({ approval }: { approval: CockpitApproval }) {
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
        <button>批准</button>
        <button>拒绝</button>
        <button>再看</button>
      </footer>
    </article>
  );
}
