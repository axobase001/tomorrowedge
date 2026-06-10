import type { CockpitTraceItem } from "../../../cockpit/contracts.js";
import type { Translator } from "../i18n.js";
import { EmptyState } from "./StateNotice.js";

export function BottomTraceSheet({ trace, t }: { trace: CockpitTraceItem[]; t: Translator }) {
  return (
    <section className="te-trace" data-testid="trace-strip">
      <strong>{t("trace.title")}</strong>
      <span className="te-chip">{t("trace.events", { count: trace.length })}</span>
      <div>{trace.length ? trace.slice(0, 12).map((item) => <span key={item.id}>{item.phase}:{item.type}</span>) : <EmptyState title={t("state.noTrace")} testId="trace-empty-state" />}</div>
    </section>
  );
}
