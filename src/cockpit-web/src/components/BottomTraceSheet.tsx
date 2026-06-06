import type { CockpitTraceItem } from "../../../cockpit/contracts.js";

export function BottomTraceSheet({ trace }: { trace: CockpitTraceItem[] }) {
  return (
    <section className="te-trace">
      <strong>Trace</strong>
      <span className="te-chip">{trace.length} 事件</span>
      <div>{trace.slice(0, 12).map((item) => <span key={item.id}>{item.phase}:{item.type}</span>)}</div>
    </section>
  );
}
